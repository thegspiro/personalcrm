/**
 * iCalendar (RFC 5545) — the dates worth being reminded about.
 *
 * Birthdays and anniversaries are the highest-value thing in this app that a
 * calendar can hold, and until now there was no way to get them into one. Each
 * becomes an all-day event, recurring where the stored date recurs.
 */
import { hasKnownDay, hasKnownMonth, hasKnownYear, type DatePrecision } from "@/lib/date-precision";
import type { PlainDate } from "@/lib/dates";
import { escapeValue, joinLines } from "./text";

export type IcsRecurrence = "NONE" | "ANNUAL" | "MONTHLY";

export interface IcsEvent {
  /** Stable across exports, so re-importing updates rather than duplicates. */
  uid: string;
  summary: string;
  description: string | null;
  date: PlainDate;
  precision: DatePrecision;
  recurrence: IcsRecurrence;
  /**
   * The last day an all-day event covers, inclusive. Omitted for a single day.
   *
   * A trip is one entry that spans a fortnight, not fourteen entries. The
   * calendar page draws it as a chip per day because a grid has squares; a
   * calendar client understands a span, so it is given one.
   */
  lastDate?: PlainDate;
  /**
   * Present when the event happens at a time rather than on a day, which
   * supersedes the all-day rendering entirely.
   *
   * Instants, already resolved against the account's timezone by the caller.
   * Resolved rather than carried as a local time plus a zone because emitting
   * `TZID` obliges the file to carry a matching `VTIMEZONE` with the zone's
   * full daylight-saving history, and getting that subtly wrong moves an
   * appointment by an hour twice a year. A UTC instant cannot be misread.
   *
   * `end` is omitted when the source records no length. RFC 5545 reads a timed
   * event with no `DTEND` as ending when it starts, which is the honest answer
   * to "dinner at seven, for who knows how long" — padding it to an hour would
   * put a made-up finish time in somebody's calendar.
   */
  timed?: { start: Date; end?: Date };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function dateValue(date: PlainDate): string {
  return `${pad(date.year, 4)}${pad(date.month, 2)}${pad(date.day, 2)}`;
}

/** An instant as a UTC DATE-TIME, e.g. `20260906T230000Z`. */
function utcValue(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/** The day after, which is what an all-day event uses as its exclusive end. */
function nextDay(date: PlainDate): PlainDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Anchor a date that may not know its own year.
 *
 * A calendar entry has to land on a real day, so a birthday with no year is
 * placed in `anchorYear` and left to recur from there — which is what a yearly
 * reminder means anyway. Returns null when the stored date says too little to
 * place at all: a bare year has no day, and choosing one would invent an
 * anniversary nobody recorded.
 */
export function anchorDate(
  date: PlainDate,
  precision: DatePrecision,
  anchorYear: number,
): PlainDate | null {
  if (!hasKnownMonth(precision) || !hasKnownDay(precision)) return null;
  if (hasKnownYear(precision)) return date;

  // The twenty-ninth of February, year unknown, has to be anchored to a year
  // that has one. Dropped into an ordinary year it produces a start date that
  // does not exist, which a calendar either rejects or silently reads as the
  // first of March — turning somebody's birthday into the wrong day rather
  // than admitting it could not place it.
  const year =
    date.month === 2 && date.day === 29 ? mostRecentLeapYear(anchorYear) : anchorYear;
  return { ...date, year };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The closest leap year at or before `year`, so the anchor stays in the past. */
function mostRecentLeapYear(year: number): number {
  let candidate = year;
  while (!isLeapYear(candidate)) candidate -= 1;
  return candidate;
}

function rrule(recurrence: IcsRecurrence): string | null {
  if (recurrence === "ANNUAL") return "RRULE:FREQ=YEARLY";
  if (recurrence === "MONTHLY") return "RRULE:FREQ=MONTHLY";
  return null;
}

/**
 * One event, or nothing when the date cannot be placed on a calendar.
 *
 * `stamp` is the moment the file was produced, which RFC 5545 requires on
 * every event and which is taken as an argument so a test can assert the
 * output rather than the clock.
 */
export function icsEvent(event: IcsEvent, anchorYear: number, stamp: Date): string[] | null {
  // Anchoring a year-less date is only honest because the event then recurs
  // from there — that is what a yearly reminder means. A one-time event has no
  // RRULE to say so, so the same anchor would assert that something happened
  // in a year nobody supplied. The calendar query leaves this combination out
  // for the same reason.
  if (event.recurrence === "NONE" && !hasKnownYear(event.precision)) return null;

  const start = anchorDate(event.date, event.precision, anchorYear);
  if (!start) return null;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeValue(event.uid)}`,
    `DTSTAMP:${utcValue(stamp)}`,
    ...(event.timed
      ? [
          // Already resolved to instants against the account's timezone, so
          // this needs no VTIMEZONE and cannot be misread.
          `DTSTART:${utcValue(event.timed.start)}`,
          ...(event.timed.end ? [`DTEND:${utcValue(event.timed.end)}`] : []),
        ]
      : [
          // All-day: a DATE value rather than a DATE-TIME, so no timezone is
          // implied and the day does not drift for whoever opens it.
          `DTSTART;VALUE=DATE:${dateValue(start)}`,
          // The end of an all-day event is exclusive, so it is the day after
          // the last one it covers. Omitting it leaves the duration to the
          // reader, and readers disagree.
          `DTEND;VALUE=DATE:${dateValue(nextDay(event.lastDate ?? start))}`,
        ]),
    `SUMMARY:${escapeValue(event.summary)}`,
  ];

  const rule = rrule(event.recurrence);
  if (rule) lines.push(rule);
  if (event.description) lines.push(`DESCRIPTION:${escapeValue(event.description)}`);

  lines.push("END:VEVENT");
  return lines;
}

/** A whole calendar. Events that cannot be placed are left out, not faked. */
export function icsDocument(
  events: readonly IcsEvent[],
  anchorYear: number,
  stamp: Date,
  options: { name?: string } = {},
): string {
  const body = events.flatMap((event) => icsEvent(event, anchorYear, stamp) ?? []);
  return joinLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Personal CRM//Export//EN",
    "CALSCALE:GREGORIAN",
    // Published rather than requested: nobody is being invited to anything.
    "METHOD:PUBLISH",
    // Not part of RFC 5545, but it is what every calendar client actually
    // reads to label a subscription. Without it the calendar is named after
    // its URL, which for a feed is an opaque token.
    ...(options.name
      ? [`X-WR-CALNAME:${escapeValue(options.name)}`, `NAME:${escapeValue(options.name)}`]
      : []),
    ...body,
    "END:VCALENDAR",
  ]);
}
