import { addPlainDays, diffPlainDays, nextOccurrence, type PlainDate, type Recurrence } from "./dates";

export const DEFAULT_REMINDER_DAYS = [7, 0] as const;

export type ReminderPolicy = number[] | null;

/** The form always sends a mode, so default, disabled, and an invalid custom value cannot collapse. */
export function parseReminderDays(mode: string | undefined, raw: string | undefined): ReminderPolicy {
  if (mode === "default") return null;
  if (mode === "disabled") return [];
  if (mode === "on-day") return [0];
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

export function effectiveReminderDays(policy: ReminderPolicy): number[] {
  return policy === null ? [...DEFAULT_REMINDER_DAYS] : policy;
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

export function reminderPolicyLabel(policy: ReminderPolicy): string {
  if (policy === null) return "Account default · 1 week before and on the day";
  if (policy.length === 0) return "No reminders";
  return `Custom · ${policy.map((day) => day === 0 ? "on the day" : `${day} day${day === 1 ? "" : "s"} before`).join(", ")}`;
}
