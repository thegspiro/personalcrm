/**
 * Partial dates.
 *
 * Backfilled history is rarely exact. "She moved to Austin in 2019" is a real
 * fact worth recording, and storing it as 2019-01-01 turns a vague memory into
 * a confident-looking lie the moment anyone reads it back. So every
 * user-supplied historical date carries the precision it was entered at, and
 * the UI renders only what is actually known.
 *
 * The stored `date` is always a full calendar date — the anchor. Precision says
 * how much of it to trust:
 *
 *   DAY        2019-03-14  ->  "March 14, 2019"
 *   MONTH      2019-03-01  ->  "March 2019"        (day is padding)
 *   YEAR       2019-01-01  ->  "2019"              (month and day are padding)
 *   MONTH_DAY  1900-03-14  ->  "March 14"          (year is padding)
 */
import {
  type PlainDate,
  addPlainDays,
  daysInMonth,
  diffPlainDays,
  plainDateKey,
} from "./dates";

export type DatePrecision = "DAY" | "MONTH" | "YEAR" | "MONTH_DAY";

export const DATE_PRECISIONS: readonly DatePrecision[] = ["DAY", "MONTH", "YEAR", "MONTH_DAY"];

/**
 * Year written into the anchor when the real year is unknown. A leap year, so
 * a February 29th birthday survives the round-trip.
 */
export const UNKNOWN_YEAR = 1904;

export const PRECISION_LABELS: Record<DatePrecision, string> = {
  DAY: "Exact date",
  MONTH: "Month and year",
  YEAR: "Year only",
  MONTH_DAY: "Day and month, year unknown",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

const MONTH_LOOKUP = new Map<string, number>();
MONTHS.forEach((name, index) => {
  MONTH_LOOKUP.set(name.toLowerCase(), index + 1);
  MONTH_LOOKUP.set(MONTHS_SHORT[index].toLowerCase(), index + 1);
});

export interface PartialDate {
  date: PlainDate;
  precision: DatePrecision;
}

export function hasKnownYear(precision: DatePrecision): boolean {
  return precision !== "MONTH_DAY";
}

export function hasKnownMonth(precision: DatePrecision): boolean {
  return precision !== "YEAR";
}

export function hasKnownDay(precision: DatePrecision): boolean {
  return precision === "DAY" || precision === "MONTH_DAY";
}

/**
 * Zero out the parts a precision doesn't know, so two dates entered at the same
 * precision always store the same anchor and compare equal.
 */
export function normalizeToPrecision(date: PlainDate, precision: DatePrecision): PlainDate {
  switch (precision) {
    case "DAY":
      return date;
    case "MONTH":
      return { year: date.year, month: date.month, day: 1 };
    case "YEAR":
      return { year: date.year, month: 1, day: 1 };
    case "MONTH_DAY":
      return {
        year: UNKNOWN_YEAR,
        month: date.month,
        day: Math.min(date.day, daysInMonth(UNKNOWN_YEAR, date.month)),
      };
  }
}

export interface FormatOptions {
  /** "Mar 14, 2019" instead of "March 14, 2019". */
  short?: boolean;
  /** Include the weekday when the precision is a full date. */
  weekday?: boolean;
}

export function formatPartialDate(
  date: PlainDate,
  precision: DatePrecision,
  options: FormatOptions = {},
): string {
  const months = options.short ? MONTHS_SHORT : MONTHS;
  const month = months[date.month - 1] ?? "";

  switch (precision) {
    case "YEAR":
      return String(date.year);
    case "MONTH":
      return `${month} ${date.year}`;
    case "MONTH_DAY":
      return `${month} ${date.day}`;
    case "DAY": {
      const base = `${month} ${date.day}, ${date.year}`;
      if (!options.weekday) return base;
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).toLocaleDateString(
        "en-US",
        { weekday: "long", timeZone: "UTC" },
      );
      return `${weekday}, ${base}`;
    }
  }
}

/** Render a period, collapsing a shared year: "March – June 2019". */
export function formatPartialRange(
  start: PlainDate,
  startPrecision: DatePrecision,
  end: PlainDate | null,
  endPrecision: DatePrecision | null,
  options: FormatOptions = {},
): string {
  const from = formatPartialDate(start, startPrecision, options);
  if (!end || !endPrecision) return from;

  const to = formatPartialDate(end, endPrecision, options);
  if (from === to) return from;

  // "March 2019 – June 2019" reads better as "March – June 2019".
  if (
    startPrecision === "MONTH" &&
    endPrecision === "MONTH" &&
    start.year === end.year
  ) {
    const months = options.short ? MONTHS_SHORT : MONTHS;
    return `${months[start.month - 1]} – ${months[end.month - 1]} ${end.year}`;
  }

  return `${from} – ${to}`;
}

/**
 * The span of real time a partial date could mean. Used for sorting mixed
 * precisions and for date-range filters: "2019" overlaps a filter for March
 * 2019, even though its anchor is January 1st.
 */
export function precisionRange(
  date: PlainDate,
  precision: DatePrecision,
): { start: PlainDate; end: PlainDate } {
  const anchor = normalizeToPrecision(date, precision);

  switch (precision) {
    case "DAY":
    case "MONTH_DAY":
      return { start: anchor, end: anchor };
    case "MONTH":
      return {
        start: anchor,
        end: { year: anchor.year, month: anchor.month, day: daysInMonth(anchor.year, anchor.month) },
      };
    case "YEAR":
      return {
        start: anchor,
        end: { year: anchor.year, month: 12, day: 31 },
      };
  }
}

/**
 * Sort key for a feed mixing precisions. Fuzzy dates sort by the start of their
 * range, so "2019" sits with early 2019 rather than drifting to the end.
 */
export function sortKey(date: PlainDate, precision: DatePrecision): string {
  return plainDateKey(precisionRange(date, precision).start);
}

/**
 * Reverse-chronological comparator — newest first, matching how the timeline
 * reads. Ties break so the more precise value comes first, which keeps an exact
 * date above a whole year that merely starts on the same day.
 */
export function comparePartialDates(a: PartialDate, b: PartialDate): number {
  const aStart = precisionRange(a.date, a.precision).start;
  const bStart = precisionRange(b.date, b.precision).start;
  // Positive when `a` is the later date, which must sort earlier in the list.
  const delta = diffPlainDays(bStart, aStart);
  if (delta !== 0) return delta > 0 ? -1 : 1;

  const rank: Record<DatePrecision, number> = { DAY: 0, MONTH_DAY: 0, MONTH: 1, YEAR: 2 };
  return rank[a.precision] - rank[b.precision];
}

/** True when a partial date could fall inside an inclusive range. */
export function overlapsRange(
  date: PlainDate,
  precision: DatePrecision,
  from: PlainDate | null,
  to: PlainDate | null,
): boolean {
  const { start, end } = precisionRange(date, precision);
  if (from && diffPlainDays(from, end) < 0) return false;
  if (to && diffPlainDays(start, to) < 0) return false;
  return true;
}

/**
 * Parse what someone typed into a date plus the precision it implies.
 *
 * Deliberately conservative: it recognises unambiguous shapes and returns null
 * otherwise, leaving anything vaguer to the natural-language parser. The point
 * is that typing "2019" records a year, not January 1st.
 */
export function parsePartialDate(input: string): PartialDate | null {
  const text = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return null;

  // 2019
  let m = /^(\d{4})$/.exec(text);
  if (m) {
    const year = Number(m[1]);
    if (!isPlausibleYear(year)) return null;
    return { date: { year, month: 1, day: 1 }, precision: "YEAR" };
  }

  // 2019-03 or 2019/03
  m = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!isPlausibleYear(year) || !isMonth(month)) return null;
    return { date: { year, month, day: 1 }, precision: "MONTH" };
  }

  // 2019-03-14 or 2019/3/14
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!isPlausibleYear(year) || !isValidDay(year, month, day)) return null;
    return { date: { year, month, day }, precision: "DAY" };
  }

  // march 2019 / mar 2019
  m = /^([a-z]+) (\d{4})$/.exec(text);
  if (m) {
    const month = MONTH_LOOKUP.get(m[1]);
    const year = Number(m[2]);
    if (!month || !isPlausibleYear(year)) return null;
    return { date: { year, month, day: 1 }, precision: "MONTH" };
  }

  // march 14 2019 / mar 14 2019
  m = /^([a-z]+) (\d{1,2}) (\d{4})$/.exec(text);
  if (m) {
    const month = MONTH_LOOKUP.get(m[1]);
    const year = Number(m[3]);
    const day = Number(m[2]);
    if (!month || !isPlausibleYear(year) || !isValidDay(year, month, day)) return null;
    return { date: { year, month, day }, precision: "DAY" };
  }

  // march 14 — a birthday whose year nobody remembers
  m = /^([a-z]+) (\d{1,2})$/.exec(text);
  if (m) {
    const month = MONTH_LOOKUP.get(m[1]);
    const day = Number(m[2]);
    if (!month || !isValidDay(UNKNOWN_YEAR, month, day)) return null;
    return { date: { year: UNKNOWN_YEAR, month, day }, precision: "MONTH_DAY" };
  }

  // 03-14 / 3/14
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!isMonth(month) || !isValidDay(UNKNOWN_YEAR, month, day)) return null;
    return { date: { year: UNKNOWN_YEAR, month, day }, precision: "MONTH_DAY" };
  }

  return null;
}

/**
 * Age, or years elapsed, when the year is known. Returns null for MONTH_DAY,
 * where the answer is genuinely unknowable rather than zero.
 */
export function yearsSince(
  date: PlainDate,
  precision: DatePrecision,
  today: PlainDate,
): number | null {
  if (!hasKnownYear(precision)) return null;

  const anchor = normalizeToPrecision(date, precision);
  let years = today.year - anchor.year;
  if (precision === "YEAR") return Math.max(0, years);

  const monthPassed =
    today.month > anchor.month ||
    (today.month === anchor.month && (precision === "MONTH" || today.day >= anchor.day));
  if (!monthPassed) years -= 1;
  return Math.max(0, years);
}

/** Shift a partial date by whole days, keeping its precision meaningful. */
export function shiftPartialDate(
  date: PlainDate,
  precision: DatePrecision,
  days: number,
): PlainDate {
  return normalizeToPrecision(addPlainDays(date, days), precision);
}

function isPlausibleYear(year: number): boolean {
  return year >= 1900 && year <= 2200;
}

function isMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function isValidDay(year: number, month: number, day: number): boolean {
  return isMonth(month) && Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month);
}
