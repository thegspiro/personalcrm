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
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function dateValue(date: PlainDate): string {
  return `${pad(date.year, 4)}${pad(date.month, 2)}${pad(date.day, 2)}`;
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
  return hasKnownYear(precision) ? date : { ...date, year: anchorYear };
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
  const start = anchorDate(event.date, event.precision, anchorYear);
  if (!start) return null;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeValue(event.uid)}`,
    `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    // All-day: a DATE value rather than a DATE-TIME, so no timezone is implied
    // and the day does not drift for whoever opens it.
    `DTSTART;VALUE=DATE:${dateValue(start)}`,
    // The end of an all-day event is exclusive, so it is the following day.
    // Omitting it leaves the duration to the reader, and readers disagree.
    `DTEND;VALUE=DATE:${dateValue(nextDay(start))}`,
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
): string {
  const body = events.flatMap((event) => icsEvent(event, anchorYear, stamp) ?? []);
  return joinLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Personal CRM//Export//EN",
    "CALSCALE:GREGORIAN",
    // Published rather than requested: nobody is being invited to anything.
    "METHOD:PUBLISH",
    ...body,
    "END:VCALENDAR",
  ]);
}
