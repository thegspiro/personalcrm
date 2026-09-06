import { addPlainDays, diffPlainDays, nextOccurrence, type PlainDate, type Recurrence } from "./dates";

export const DEFAULT_REMINDER_DAYS = [7, 0] as const;

export type ReminderPolicy = number[] | null;

/** The form always sends a mode, so default, disabled, and an invalid custom value cannot collapse. */
export function parseReminderDays(mode: string | undefined, raw: string | undefined): ReminderPolicy {
  if (mode === "default") return null;
  if (mode === "disabled") return [];
  if (mode === "on-day") return [0];
  // The natural offset for something you arranged, as opposed to a birthday.
  // Additive: no existing caller offers it, so no stored policy changes.
  if (mode === "day-before") return [1];
  if (mode === "week") return [7];
  if (mode === "month") return [30];
  if (mode !== "custom") throw new Error("Choose a reminder policy.");

  const parts = (raw ?? "").split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Enter at least one reminder offset.");
  const days = parts.map(Number);
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) {
    throw new Error("Reminder offsets must be whole days from 0 to 365.");
  }
  return [...new Set(days)].sort((a, b) => b - a);
}

/**
 * What came back out of a `Json?` column, narrowed to a policy.
 *
 * Every writer goes through `parseReminderDays`, so in practice the column
 * holds either null or an array of whole days — but it is `Json`, so nothing
 * in the database enforces that, and a hand-edited row must not reach
 * `dueOccurrence` as a string. Anything that is not an array reads as null,
 * and non-numbers inside one are dropped rather than carried.
 */
export function readReminderPolicy(stored: unknown): ReminderPolicy {
  if (!Array.isArray(stored)) return null;
  return stored.filter((day): day is number => typeof day === "number" && Number.isInteger(day));
}

export function effectiveReminderDays(policy: ReminderPolicy): number[] {
  return policy === null ? [...DEFAULT_REMINDER_DAYS] : policy;
}

/**
 * The offsets a *plan* sends on, where null means none at all.
 *
 * Deliberately not `effectiveReminderDays`, and the difference is the whole
 * point: for an important date, null means "the account default" — a birthday
 * is a fact of the world and the app is right to volunteer it. A plan is an
 * arrangement the user made, and announcing it unasked is not the app's to
 * decide. Reusing the other function would also have meant every plan already
 * sitting at PLANNED sending two reminders on the first hourly pass after the
 * upgrade that shipped this, which nobody opted into.
 *
 * `DEFAULT_REMINDER_DAYS` stays exactly as it is; it is still right for dates.
 */
export function effectivePlanReminderDays(policy: ReminderPolicy): number[] {
  return policy === null ? [] : policy;
}

export function dueOccurrence(
  anchor: PlainDate,
  recurrence: Recurrence,
  today: PlainDate,
  daysBefore: number,
): PlainDate | null {
  const occurrence = nextOccurrence(anchor, addPlainDays(today, daysBefore), recurrence);
  return occurrence && diffPlainDays(today, occurrence) === daysBefore ? occurrence : null;
}

/**
 * How a plan's own policy reads.
 *
 * `reminderPolicyLabel` cannot be reused: it renders null as "Account default ·
 * 1 week before and on the day", which for a plan would describe the default
 * as the one thing it is not.
 */
export function planReminderPolicyLabel(policy: ReminderPolicy): string {
  const days = effectivePlanReminderDays(policy);
  if (days.length === 0) return "No reminders";
  // No "Custom ·" prefix, unlike a date: there is no account default for a plan
  // to be custom against, so the word would be describing nothing.
  return `Reminder${days.length === 1 ? "" : "s"} · ${days.map(reminderOffsetLabel).join(", ")}`;
}

function reminderOffsetLabel(day: number): string {
  return day === 0 ? "on the day" : `${day} day${day === 1 ? "" : "s"} before`;
}

export function reminderPolicyLabel(policy: ReminderPolicy): string {
  if (policy === null) return "Account default · 1 week before and on the day";
  if (policy.length === 0) return "No reminders";
  return `Custom · ${policy.map((day) => day === 0 ? "on the day" : `${day} day${day === 1 ? "" : "s"} before`).join(", ")}`;
}
