import {
  addPlainDays,
  comparePlainDates,
  type PlainDate,
} from "./dates";
import { precisionRange, type DatePrecision } from "./date-precision";

/**
 * Informal calendar information: one-off, near-future things going on in
 * someone else's life.
 *
 * Pure by design — no Prisma, no request context — so every boundary here is
 * testable without a database. The queries and the actions supply the rows and
 * the timezone-anchored "today"; nothing in this file reads a clock.
 */

export type AvailabilityImpact = "NONE" | "BUSY" | "AWAY";

export const AVAILABILITY_IMPACTS: readonly AvailabilityImpact[] = ["NONE", "BUSY", "AWAY"];

/** What the form offers. "Worth knowing" is the honest default: most things are. */
export const AVAILABILITY_LABELS: Record<AvailabilityImpact, string> = {
  NONE: "Just worth knowing",
  BUSY: "Busy — around, but committed",
  AWAY: "Away — out of town",
};

/** The short form, for the badge on a row. NONE earns no badge at all. */
export const AVAILABILITY_BADGES: Record<AvailabilityImpact, string | null> = {
  NONE: null,
  BUSY: "Busy",
  AWAY: "Away",
};

export interface HappeningDates {
  date: PlainDate;
  precision: DatePrecision;
  endDate: PlainDate | null;
  endPrecision: DatePrecision | null;
}

export type HappeningPhase = "upcoming" | "ongoing" | "ended";

/**
 * The span of real time a happening could occupy, widened to cover the
 * vagueness at each end.
 *
 * "Sometime in October" is the whole month, not October 1st — so a trip
 * recorded that way is still "ongoing" on the 20th rather than three weeks
 * past. A missing end date means the start alone, widened the same way.
 */
export function happeningSpan(dates: HappeningDates): { start: PlainDate; end: PlainDate } {
  const start = precisionRange(dates.date, dates.precision).start;
  const end =
    dates.endDate && dates.endPrecision
      ? precisionRange(dates.endDate, dates.endPrecision).end
      : precisionRange(dates.date, dates.precision).end;

  // A recorded end that lands before the start cannot narrow the span; the
  // action refuses that combination, but a row edited directly should still
  // render as something rather than as an empty interval.
  return comparePlainDates(end, start) < 0 ? { start, end: start } : { start, end };
}

/** Where a happening sits relative to a day, both ends inclusive. */
export function happeningPhase(dates: HappeningDates, today: PlainDate): HappeningPhase {
  const { start, end } = happeningSpan(dates);
  if (comparePlainDates(today, start) < 0) return "upcoming";
  if (comparePlainDates(today, end) > 0) return "ended";
  return "ongoing";
}

/**
 * When to ask how it went: the day after the last day it could still be
 * happening.
 *
 * Anchored to the *end* of the precision range rather than the stored date, so
 * "sometime in October" is followed up on November 1st. Following up on
 * October 2nd would be asking about a trip they had not taken yet — the exact
 * failure that storing a partial date as a real one causes everywhere else.
 */
export function followUpDueDate(dates: HappeningDates): PlainDate {
  return addPlainDays(happeningSpan(dates).end, 1);
}

/** Task.title is VARCHAR(191); MariaDB would otherwise reject the insert. */
export const TASK_TITLE_MAX = 191;

/**
 * The follow-up task's title.
 *
 * Names the happening rather than the person: the task already carries the
 * contact, and "Ask how the Portugal trip went" reads on the task list without
 * having to open it.
 */
export function followUpTaskTitle(happeningTitle: string): string {
  const title = `Ask how “${happeningTitle.trim()}” went`;
  if (title.length <= TASK_TITLE_MAX) return title;

  // Trim the happening rather than the sentence, so the question survives.
  const overflow = title.length - TASK_TITLE_MAX;
  const trimmed = happeningTitle.trim().slice(0, Math.max(1, happeningTitle.trim().length - overflow - 1));
  return `Ask how “${trimmed}…” went`.slice(0, TASK_TITLE_MAX);
}
