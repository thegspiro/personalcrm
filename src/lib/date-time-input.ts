import {
  type PlainDate,
  addPlainDays,
  clampPlainDate,
  parsePlainDate,
  plainDateKey,
} from "@/lib/dates";

/**
 * The value an `<input type="datetime-local">` carries, taken apart.
 *
 * A `datetime-local` is a wall-clock reading with no zone — the same kind of
 * value `src/lib/dates.ts` calls a plain date, with an hour and a minute on the
 * end. Parsing it into a real `Date` to do arithmetic and formatting it back is
 * what this exists to avoid: `new Date("2026-11-01T01:30")` resolves against
 * the browser's zone, and on the two days a year that are not 24 hours long
 * that resolution is ambiguous or impossible. Nothing here constructs a `Date`
 * except to read one the caller already has.
 *
 * Pure, so the picker's arithmetic is unit-testable without a browser.
 */
export interface LocalDateTime {
  date: PlainDate;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
}

/** Seconds are optional: a browser emits them when `step` is finer than a minute. */
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const LOCAL_TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Read an input's value, or null when it is empty or half-typed. */
export function parseLocalDateTime(value: string): LocalDateTime | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;
  const date = parsePlainDate(match[1]);
  if (!date) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  return { date, hour, minute };
}

/**
 * Build a value an input will accept.
 *
 * The day is clamped on the way out for the same reason `DateField` clamps: a
 * month is chosen separately from a day, and `2026-02-31` is not a value any
 * input displays — it renders blank, which reads as the date having been lost.
 */
export function formatLocalDateTime(value: LocalDateTime): string {
  return `${plainDateKey(clampPlainDate(value.date))}T${pad(value.hour)}:${pad(value.minute)}`;
}

/** The wall clock an instant reads as in the browser's own zone. */
export function localDateTimeFromDate(instant: Date): LocalDateTime | null {
  if (Number.isNaN(instant.getTime())) return null;
  return {
    date: {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
    },
    hour: instant.getHours(),
    minute: instant.getMinutes(),
  };
}

/** Move whole days and keep the time of day, across DST and across a year end. */
export function shiftLocalDays(value: LocalDateTime, days: number): LocalDateTime {
  return { ...value, date: addPlainDays(value.date, days) };
}

/** Put a new day on an existing time. */
export function withLocalDate(value: LocalDateTime, date: PlainDate): LocalDateTime {
  return { ...value, date };
}

/** Read a `<input type="time">` value onto an existing day, or null if incomplete. */
export function withLocalTime(value: LocalDateTime, raw: string): LocalDateTime | null {
  const match = LOCAL_TIME.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { ...value, hour, minute };
}

/**
 * The value as a person reads it: "September 11, 2026 at 6:00 PM".
 *
 * Formatted through UTC on both sides, the same trick the calendar grid uses:
 * a `LocalDateTime` is a wall clock with no zone, and letting a local `Date`
 * carry it would name the day before for anyone west of Greenwich.
 */
export function formatLocalDateTimeLabel(value: LocalDateTime): string {
  const date = clampPlainDate(value.date);
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, value.hour, value.minute),
  ).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The `HH:mm` half, for a `<input type="time">`. */
export function localTimeValue(value: LocalDateTime): string {
  return `${pad(value.hour)}:${pad(value.minute)}`;
}
