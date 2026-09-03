import { createHash } from "node:crypto";
import { calendarDateInTz, diffPlainDays, plainDateKey, type PlainDate } from "./dates";
import { formatDailyDigest } from "./digest-formatter";

export type SchedulingPolicy = "IMPORTANT_DATE_OFFSET" | "OVERDUE_CADENCE" | "INCOMPLETE_TASK_DUE" | "DAILY_DIGEST";

export interface ReminderMessage {
  subject: string;
  body: string;
}

export { formatDailyDigest } from "./digest-formatter";

export function localClock(instant: Date, timezone: string): PlainDate & { hour: number } {
  const date = calendarDateInTz(instant, timezone);
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant));
  return { ...date, hour };
}

/** A late hourly pass still sends today's digest; the date key prevents repeats. */
export function digestIsDue(now: Date, timezone: string, digestHour: number): boolean {
  return localClock(now, timezone).hour >= Math.max(0, Math.min(23, digestHour));
}

/** Stable across restarts and compact enough for a database unique index. */
export function reminderDedupKey(parts: {
  ownerId: string;
  entityType: string;
  entityId: string;
  policy: SchedulingPolicy;
  occurrence: string;
  offsetDays: number;
  channelId: string;
}): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function dailyOccurrence(now: Date, timezone: string): string {
  return plainDateKey(calendarDateInTz(now, timezone));
}

/**
 * What each policy says when it sends.
 *
 * Worded from the day it is actually sent on, not the day it was first owed:
 * a reminder that failed on the last pass of one day and goes out on the first
 * pass of the next must not still claim the date is "tomorrow".
 */
export function importantDateMessage(
  label: string,
  person: string,
  occurrence: PlainDate,
  today: PlainDate,
): ReminderMessage {
  const days = diffPlainDays(today, occurrence);
  const when =
    days === 0 ? "is today"
    : days === 1 ? "is tomorrow"
    : days > 1 ? `is in ${days} days`
    : days === -1 ? "was yesterday"
    : `was ${-days} days ago`;
  return {
    subject: `Reminder: ${label}`,
    body: `${label} for ${person} ${when} (${plainDateKey(occurrence)}).`,
  };
}

export function cadenceMessage(person: string, dueDay: PlainDate): ReminderMessage {
  return {
    subject: `Time to reach out to ${person}`,
    body: `${person}'s keep-in-touch cadence has been due since ${plainDateKey(dueDay)}.`,
  };
}

export function taskMessage(title: string, person: string | null, dueDay: PlainDate): ReminderMessage {
  return {
    subject: `Task due: ${title}`,
    body: `${title}${person ? ` for ${person}` : ""} was due ${plainDateKey(dueDay)}.`,
  };
}

export function digestMessage(cadenceCount: number, taskCount: number): ReminderMessage {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  return formatDailyDigest({
    sections: [{
      heading: "Due today",
      entries: [`${plural(cadenceCount, "cadence reminder")} and ${plural(taskCount, "due task")} need attention today.`],
    }],
  });
}
