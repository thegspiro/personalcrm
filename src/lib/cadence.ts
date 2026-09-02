/**
 * Keep-in-touch cadences: the rule that decides who shows up on the
 * "reach out" list. Pure functions so the dashboard, the nightly reminder job,
 * and the contact page all agree on what "overdue" means.
 */
import { addPlainDays, calendarDateInTz, diffPlainDays, MS_PER_DAY, zonedStartOfDay } from "./dates";

export type CadenceStatus = "none" | "ok" | "due-soon" | "overdue";

/** Anything due within this many days is surfaced as "due soon". */
export const DUE_SOON_DAYS = 3;

export interface CadenceInput {
  cadenceDays: number | null | undefined;
  lastInteractionAt: Date | null | undefined;
  snoozedUntil: Date | null | undefined;
  /** Falls back to the contact's creation time when they've never been logged. */
  createdAt: Date;
}

/**
 * When the next check-in is due.
 *
 * The clock starts at the later of the last interaction and the end of any
 * snooze, so snoozing someone genuinely pushes them out rather than leaving
 * them to pop straight back onto the list.
 */
export function computeNextTouchAt(input: CadenceInput): Date | null {
  const cadence = input.cadenceDays;
  if (!cadence || cadence <= 0) return null;

  const last = input.lastInteractionAt ?? input.createdAt;
  const base = Math.max(last.getTime(), input.snoozedUntil?.getTime() ?? 0);
  return new Date(base + cadence * MS_PER_DAY);
}

/**
 * Whole days until the next check-in, compared by calendar day in the user's
 * timezone — so something due at 11pm tonight reads as "today", not "in 0.04 days".
 */
export function daysUntilTouch(
  nextTouchAt: Date | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  if (!nextTouchAt) return null;
  return diffPlainDays(calendarDateInTz(now, timeZone), calendarDateInTz(nextTouchAt, timeZone));
}

/**
 * How a due date reads in a list: "3d overdue", "today", "in 4 days".
 *
 * Shared by the dashboard widget and the follow-up hub, which show the same
 * people. Two copies of this drifted apart once already.
 */
export function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${-daysUntilDue}d overdue`;
  if (daysUntilDue === 0) return "today";
  if (daysUntilDue === 1) return "tomorrow";
  return `in ${daysUntilDue} days`;
}

export function cadenceStatus(
  nextTouchAt: Date | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): CadenceStatus {
  const days = daysUntilTouch(nextTouchAt, timeZone, now);
  if (days === null) return "none";
  if (days <= 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "ok";
}

/** Days since the last logged interaction, or null if there's never been one. */
export function daysSinceLastInteraction(
  lastInteractionAt: Date | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  if (!lastInteractionAt) return null;
  return diffPlainDays(
    calendarDateInTz(lastInteractionAt, timeZone),
    calendarDateInTz(now, timeZone),
  );
}

/**
 * Snooze until the start of the day `days` out in the user's timezone.
 *
 * The arithmetic runs in calendar-date space rather than on milliseconds:
 * adding `days * MS_PER_DAY` across a DST fall-back gains an hour and lands on
 * the previous day.
 */
export function snoozeUntil(days: number, timeZone: string, now: Date = new Date()): Date {
  const target = addPlainDays(calendarDateInTz(now, timeZone), days);
  return zonedStartOfDay(target, timeZone);
}

export const CADENCE_PRESETS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: "No cadence", days: null },
  { label: "Weekly", days: 7 },
  { label: "Every 2 weeks", days: 14 },
  { label: "Monthly", days: 30 },
  { label: "Every 2 months", days: 60 },
  { label: "Quarterly", days: 90 },
  { label: "Twice a year", days: 182 },
  { label: "Yearly", days: 365 },
];

export function cadenceLabel(days: number | null | undefined): string {
  if (!days) return "No cadence";
  const preset = CADENCE_PRESETS.find((p) => p.days === days);
  return preset ? preset.label : `Every ${days} days`;
}
