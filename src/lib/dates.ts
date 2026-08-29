/**
 * Timezone-aware calendar math, implemented on Intl so we don't need a tz
 * database dependency. Everything here is pure and unit-tested.
 *
 * Two kinds of value show up in this app and they are NOT interchangeable:
 *
 *  * Instants  — `Interaction.occurredAt`, `Contact.nextTouchAt`. Real points in
 *    time; converting them to a calendar day requires the user's timezone.
 *  * Plain dates — anything stored as MySQL DATE (`ImportantDate.date`,
 *    `Task.dueDate`). Prisma hands these back as UTC midnight, and they must be
 *    read with the UTC getters so a birthday never drifts a day.
 */

export const MS_PER_DAY = 86_400_000;

export interface PlainDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const v: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") v[p.type] = Number(p.value);
  const asIfUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The calendar date an instant falls on, as seen in `timeZone`. */
export function calendarDateInTz(instant: Date, timeZone: string): PlainDate {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const v: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") v[p.type] = Number(p.value);
  return { year: v.year, month: v.month, day: v.day };
}

/**
 * The instant at which the given calendar day begins in `timeZone`.
 * Solved iteratively because the offset itself depends on the answer (DST).
 */
export function zonedStartOfDay(date: PlainDate, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0);
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  // One correction pass resolves days where the offset changes at midnight.
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function startOfDayInTz(instant: Date, timeZone: string): Date {
  return zonedStartOfDay(calendarDateInTz(instant, timeZone), timeZone);
}

/** Read a MySQL DATE column (Prisma gives UTC midnight) as a plain calendar date. */
export function plainDateFromDb(value: Date): PlainDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

/** Build a value suitable for writing back into a MySQL DATE column. */
export function plainDateToDb(date: PlainDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function plainDateKey(date: PlainDate): string {
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${date.year}-${m}-${d}`;
}

export function parsePlainDate(key: string): PlainDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject dates like 2025-02-30 that would silently roll over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function addPlainDays(date: PlainDate, days: number): PlainDate {
  const t = Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY;
  return plainDateFromDb(new Date(t));
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function diffPlainDays(from: PlainDate, to: PlainDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

export function comparePlainDates(a: PlainDate, b: PlainDate): number {
  return diffPlainDays(b, a) === 0 ? 0 : diffPlainDays(a, b) > 0 ? -1 : 1;
}

export function todayInTz(timeZone: string, now: Date = new Date()): PlainDate {
  return calendarDateInTz(now, timeZone);
}

export type Recurrence = "NONE" | "ANNUAL" | "MONTHLY";
export type OccurrencePrecision = "DAY" | "MONTH" | "YEAR" | "MONTH_DAY";

export interface OccurrenceWindow {
  from: PlainDate;
  to: PlainDate;
}

/**
 * Project a stored important date into an inclusive calendar window.
 *
 * This is the single recurrence policy used by every surface. Only dates with
 * a known month and day can recur: projecting a month- or year-only value
 * would invent precision. `today` is deliberately separate from the display
 * window so callers cannot accidentally turn a past one-time date into an
 * upcoming item by asking for a historical range.
 */
export function projectDateOccurrences(
  anchor: PlainDate,
  precision: OccurrencePrecision,
  recurrence: Recurrence,
  today: PlainDate,
  window: OccurrenceWindow,
): PlainDate[] {
  if (diffPlainDays(window.from, window.to) < 0) return [];

  const from = diffPlainDays(today, window.from) >= 0 ? window.from : today;
  if (diffPlainDays(from, window.to) < 0) return [];

  if (recurrence === "NONE") {
    const end =
      precision === "YEAR"
        ? { year: anchor.year, month: 12, day: 31 }
        : precision === "MONTH"
          ? { ...anchor, day: daysInMonth(anchor.year, anchor.month) }
          : anchor;
    if (diffPlainDays(from, end) < 0 || diffPlainDays(anchor, window.to) < 0) return [];
    // A partial one-time date has no honest exact day. Use the first possible
    // day still inside the requested window as its sort/distance key; callers
    // retain the stored anchor and precision for display.
    return [diffPlainDays(from, anchor) >= 0 ? anchor : from];
  }

  if (precision === "YEAR" || precision === "MONTH") return [];

  const occurrences: PlainDate[] = [];
  if (recurrence === "ANNUAL") {
    for (let year = from.year; year <= window.to.year; year++) {
      const candidate = clampToMonth(year, anchor.month, anchor.day);
      if (diffPlainDays(from, candidate) >= 0 && diffPlainDays(candidate, window.to) >= 0) {
        occurrences.push(candidate);
      }
    }
    return occurrences;
  }

  let year = from.year;
  let month = from.month;
  while (year < window.to.year || (year === window.to.year && month <= window.to.month)) {
    const candidate = clampToMonth(year, month, anchor.day);
    if (diffPlainDays(from, candidate) >= 0 && diffPlainDays(candidate, window.to) >= 0) {
      occurrences.push(candidate);
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return occurrences;
}

/**
 * The next time a recurring date lands on or after `from`.
 *
 * Feb 29 on a common year is observed on Feb 28, and monthly recurrences that
 * name a day the month doesn't have clamp to that month's last day — the same
 * convention calendar apps use.
 */
export function nextOccurrence(
  anchor: PlainDate,
  from: PlainDate,
  recurrence: Recurrence = "ANNUAL",
): PlainDate | null {
  if (recurrence === "NONE") {
    return diffPlainDays(from, anchor) >= 0 ? anchor : null;
  }
  return projectDateOccurrences(anchor, "DAY", recurrence, from, {
    from,
    to: { year: from.year + 8, month: 12, day: 31 },
  })[0] ?? null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampToMonth(year: number, month: number, day: number): PlainDate {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

/**
 * Pull a day back into its month: February 31st becomes the 28th, or the 29th
 * on a leap year. Anything that assembles a date field by field needs this,
 * because month and day are chosen separately and nothing stops the pair from
 * naming a day that does not exist.
 */
export function clampPlainDate(date: PlainDate): PlainDate {
  return clampToMonth(date.year, date.month, date.day);
}

/** Age (or years elapsed) on the given date, or null when the year is unknown. */
export function yearsBetween(anchor: PlainDate, on: PlainDate): number {
  let years = on.year - anchor.year;
  if (on.month < anchor.month || (on.month === anchor.month && on.day < anchor.day)) {
    years -= 1;
  }
  return years;
}
