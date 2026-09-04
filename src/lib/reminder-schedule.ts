import { createHash } from "node:crypto";
import { calendarDateInTz, diffPlainDays, plainDateKey, type PlainDate } from "./dates";

export type SchedulingPolicy = "IMPORTANT_DATE_OFFSET" | "OVERDUE_CADENCE" | "INCOMPLETE_TASK_DUE" | "DAILY_DIGEST";

export interface ReminderMessage {
  subject: string;
  body: string;
}

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

/**
 * `preview` marks an item the scheduler is showing early — its reminder is not
 * owed until a later day. It cannot be derived from `date`: an important date
 * warned about a week ahead is owed *today* for an occurrence still a week
 * out, so the occurrence date says "upcoming" about work that is due now. Only
 * the scheduler knows which day the reminder belongs to, so only it can say.
 * Omitted means owed now, which is what every non-look-ahead caller wants.
 */
export type DigestItem = { preview?: boolean } & (
  | { kind: "IMPORTANT_DATE"; label: string; contactName: string; date: PlainDate }
  | { kind: "CADENCE"; contactName: string; date: PlainDate }
  | { kind: "TASK"; title: string; contactName: string | null; date: PlainDate }
);

/** Kept deliberately small enough for the most restrictive supported push channel. */
export const DIGEST_ENTRY_LIMIT = 20;

function digestEntry(item: DigestItem, today: PlainDate): string {
  const days = diffPlainDays(today, item.date);
  const timing = days < 0 ? "overdue" : days === 0 ? "due today" : "upcoming";
  const detail = item.kind === "IMPORTANT_DATE"
    ? `${item.label} — ${item.contactName}`
    : item.kind === "CADENCE"
      ? item.contactName
      : `${item.title}${item.contactName ? ` — ${item.contactName}` : ""}`;
  return `- ${detail} (${timing}: ${plainDateKey(item.date)})`;
}

/**
 * Format only the already-authorised fields supplied by the scheduler. Group
 * order is fixed; entries are ordered by date, then their visible text.
 *
 * What is already due outranks what is merely previewed, ahead of the group
 * order, so the entry cap trims the look-ahead rather than overdue work. Grouped the other
 * way, an account with twenty important dates in its look-ahead would push
 * every overdue person out of the digest and report them only as a count —
 * losing precisely the thing the digest exists to surface. Sections still
 * render in group order, and within a group this is the date order anyway.
 */
export function digestMessage(items: DigestItem[], today: PlainDate, limit = DIGEST_ENTRY_LIMIT): ReminderMessage {
  const kindOrder: DigestItem["kind"][] = ["IMPORTANT_DATE", "CADENCE", "TASK"];
  const headings: Record<DigestItem["kind"], string> = {
    IMPORTANT_DATE: "Important dates",
    CADENCE: "Keep in touch",
    TASK: "Tasks",
  };
  const stillToCome = (item: DigestItem) => (item.preview ? 1 : 0);
  const sorted = [...items].sort((a, b) => {
    const due = stillToCome(a) - stillToCome(b);
    if (due) return due;
    const kind = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    if (kind) return kind;
    const date = compareDigestDates(a.date, b.date);
    return date || digestEntry(a, today).localeCompare(digestEntry(b, today), "en");
  });
  const shown = sorted.slice(0, Math.max(0, limit));
  const sections = kindOrder.flatMap((kind) => {
    const entries = shown.filter((item) => item.kind === kind);
    return entries.length ? [`${headings[kind]}\n${entries.map((item) => digestEntry(item, today)).join("\n")}`] : [];
  });
  const hidden = sorted.length - shown.length;
  return {
    subject: "Your Personal CRM daily digest",
    body: sections.length === 0
      ? "Nothing needs your attention today."
      : `${sections.join("\n\n")}${hidden > 0 ? `\n\n… and ${hidden} more ${hidden === 1 ? "item" : "items"}.` : ""}`,
  };
}

function compareDigestDates(a: PlainDate, b: PlainDate): number {
  return plainDateKey(a).localeCompare(plainDateKey(b));
}
