import {
  type PlainDate,
  addPlainDays,
  daysInMonth,
  diffPlainDays,
  plainDateKey,
} from "@/lib/dates";

/**
 * The shape of a month grid, worked out in plain dates.
 *
 * Pure on purpose: no Prisma, no request context, no `Date`. A calendar grid is
 * the one place in this app where an off-by-one is invisible to every type
 * check and obvious to every user, so the arithmetic is unit-testable on its
 * own rather than only through a rendered page.
 *
 * Everything here is a `PlainDate` — a calendar square is a day, not an
 * instant, and `src/lib/dates.ts` opens by warning that the two are not
 * interchangeable. The conversion to instants happens once, in the query, where
 * the account's timezone is known.
 */

/** `0` = Sunday, `1` = Monday. What `UserPreference.weekStartsOn` stores. */
export type WeekStart = 0 | 1;

/** A month, without a day. What the URL carries and the grid is built from. */
export interface PlainMonth {
  year: number;
  month: number;
}

/** Always six rows: a month can span six weeks, and a grid that changes height
 * between months makes the whole page jump on every arrow press. */
export const CALENDAR_WEEKS = 6;

/** `"2026-03"`, the form the `?month=` parameter takes. */
export function plainMonthKey(month: PlainMonth): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

/**
 * Read a `?month=` parameter, or answer null.
 *
 * Null rather than a fallback, so the caller decides what "no month" means —
 * which is "the month containing today, in the account's timezone", and only
 * the caller knows the timezone.
 */
export function parsePlainMonth(raw: string | undefined | null): PlainMonth | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  // The same range `clampPlainDate` works in. A year outside it is a typed URL,
  // not a navigation, and answering null sends it back to today.
  if (year < 1 || year > 9999) return null;
  return { year, month };
}

/** The month a day falls in. */
export function monthOf(date: PlainDate): PlainMonth {
  return { year: date.year, month: date.month };
}

/** Step whole months, without going through a `Date`. */
export function addPlainMonths(month: PlainMonth, delta: number): PlainMonth {
  const zeroBased = month.year * 12 + (month.month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** The first day of a month. */
export function startOfPlainMonth(month: PlainMonth): PlainDate {
  return { year: month.year, month: month.month, day: 1 };
}

/** The last day of a month. */
export function endOfPlainMonth(month: PlainMonth): PlainDate {
  return { year: month.year, month: month.month, day: daysInMonth(month.year, month.month) };
}

/**
 * Which weekday a day falls on, 0–6 with 0 = Sunday.
 *
 * `Date.UTC` rather than a local `Date`: a plain date has no timezone, and
 * constructing one in the server's zone would make the answer depend on where
 * the container happens to be running — the mistake invariant 2 is about.
 */
export function weekdayOf(date: PlainDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * The days of the grid, in order: six rows of seven, leading and trailing days
 * from the neighbouring months included so every row is full.
 *
 * The neighbours are real days, not blanks, because a Monday-the-31st sitting
 * in the first row is where a plan often is, and hiding it would make the grid
 * lie about the week it is drawing.
 */
export function monthGridDays(month: PlainMonth, weekStartsOn: WeekStart): PlainDate[] {
  const first = startOfPlainMonth(month);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const start = addPlainDays(first, -lead);
  return Array.from({ length: CALENDAR_WEEKS * 7 }, (_, index) => addPlainDays(start, index));
}

/**
 * The window the grid actually shows, which is wider than the month.
 *
 * The query has to fetch this rather than the month, or the leading and
 * trailing squares would render empty while holding something.
 */
export function monthGridWindow(
  month: PlainMonth,
  weekStartsOn: WeekStart,
): { from: PlainDate; to: PlainDate } {
  const days = monthGridDays(month, weekStartsOn);
  return { from: days[0], to: days[days.length - 1] };
}

/** Weekday column headings, rotated to the account's first day. */
export function weekdayOrder(weekStartsOn: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, index) => (index + weekStartsOn) % 7);
}

/** Whether a grid square belongs to the month being shown, rather than a neighbour. */
export function isInMonth(date: PlainDate, month: PlainMonth): boolean {
  return date.year === month.year && date.month === month.month;
}

/**
 * Group anything carrying a day into buckets keyed by `plainDateKey`.
 *
 * One pass rather than filtering the list once per square: a month of six rows
 * asks 42 questions, and a busy account can hold hundreds of entries.
 */
export function groupByDay<T>(items: T[], dayOf: (item: T) => PlainDate): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = plainDateKey(dayOf(item));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }
  return byDay;
}

/** Whether a day falls inside an inclusive window. */
export function isWithin(date: PlainDate, window: { from: PlainDate; to: PlainDate }): boolean {
  return diffPlainDays(window.from, date) >= 0 && diffPlainDays(date, window.to) >= 0;
}
