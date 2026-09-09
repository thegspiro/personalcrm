import { createHash } from "node:crypto";
import { calendarDateInTz, diffPlainDays, plainDateKey, type PlainDate } from "./dates";

// Every value here is stored in `ReminderLog.schedulingPolicy VarChar(32)`, so
// a longer name than that is a write that fails at the database.
export type SchedulingPolicy =
  | "IMPORTANT_DATE_OFFSET"
  | "OVERDUE_CADENCE"
  | "INCOMPLETE_TASK_DUE"
  | "DAILY_DIGEST"
  | "SCHEDULED_PLAN";

export interface ReminderMessage {
  subject: string;
  body: string;
  /** The same reminder, in fields rather than prose. */
  data: ReminderData;
}

/**
 * The machine-readable half of a reminder, for channels that can carry one.
 *
 * Every field here is already stated in the body — the person's name, the
 * label, the day — so a channel that receives it learns nothing it was not
 * already being told in prose. That is the rule this type is built to keep,
 * and the reason there are no identifiers in it: a `contactId` would say
 * nothing new about *today's* message and everything about which messages
 * across months are about the same person, which the wording alone does not
 * hand over. There is nothing on the receiving end that needs one.
 *
 * It is derived here rather than in the sender so that the wording and the
 * fields cannot disagree: both are built from the same arguments, in the same
 * function, and a change to one is made looking straight at the other.
 */
export interface ReminderData {
  policy: SchedulingPolicy;
  /** The day the reminder is about, as `YYYY-MM-DD`. */
  date: string;
  /**
   * Whole days from the day this is being sent to `date`; negative has
   * already passed. The receiving end cannot work this out for itself — it
   * knows its own clock, not the owner's timezone, and those disagree for
   * several hours of every day.
   */
  daysAway: number;
  /** Important dates only. */
  label?: string;
  /** Tasks and plans only. */
  title?: string;
  /** Absent when the reminder is not about one particular person. */
  contactName?: string;
  /** Plans only, and only when the plan carries a time. */
  startsAt?: string;
  /** Digest only: the entries the body listed, in the order it listed them. */
  items?: ReminderDataItem[];
  /** Digest only: entries past the cap, which the body reports as a count. */
  hiddenItems?: number;
  /**
   * Set only by the sample the test button sends. The subject and the body
   * both say they are a sample; something reading the fields instead of the
   * words needs to be told as plainly, or a channel wired into an automation
   * acts on five invented people the first time it is tested.
   */
  sample?: true;
}

export interface ReminderDataItem {
  kind: DigestItem["kind"];
  label?: string;
  title?: string;
  contactName?: string;
  date: string;
  timing: DigestTiming;
}

export type DigestTiming = "overdue" | "due today" | "upcoming";

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
function relativeWhen(days: number): string {
  return (
    days === 0 ? "is today"
    : days === 1 ? "is tomorrow"
    : days > 1 ? `is in ${days} days`
    : days === -1 ? "was yesterday"
    : `was ${-days} days ago`
  );
}

export function importantDateMessage(
  label: string,
  person: string,
  occurrence: PlainDate,
  today: PlainDate,
): ReminderMessage {
  const days = diffPlainDays(today, occurrence);
  return {
    subject: `Reminder: ${label}`,
    body: `${label} for ${person} ${relativeWhen(days)} (${plainDateKey(occurrence)}).`,
    data: {
      policy: "IMPORTANT_DATE_OFFSET",
      date: plainDateKey(occurrence),
      daysAway: days,
      label,
      contactName: person,
    },
  };
}

/**
 * A plan you arranged, said from the day the reminder actually goes out.
 *
 * The time is included when the plan carries one, because "on Friday" and
 * "on Friday at 7:30pm" are different amounts of use, and a plan is the one
 * reminder kind that knows the hour.
 */
export function scheduledPlanMessage(
  title: string,
  person: string | null,
  occurrence: PlainDate,
  today: PlainDate,
  startsAt: string | null,
): ReminderMessage {
  const days = diffPlainDays(today, occurrence);
  const who = person ? ` with ${person}` : "";
  const at = startsAt ? ` at ${startsAt}` : "";
  return {
    // The subject carries the tense as well as the body. Every channel shows it
    // — it is the email subject, the ntfy and Gotify title, the Discord heading
    // — and several show nothing else until the message is opened, so a retry
    // that finally lands the morning after would have announced a finished
    // evening as "Coming up". `Reminder:` is what an important date already
    // uses once its day has passed, and it makes no claim about the tense.
    subject: `${days < 0 ? "Reminder" : "Coming up"}: ${title}`,
    body: `${title}${who} ${relativeWhen(days)}${at} (${plainDateKey(occurrence)}).`,
    data: {
      policy: "SCHEDULED_PLAN",
      date: plainDateKey(occurrence),
      daysAway: days,
      title,
      ...(person ? { contactName: person } : {}),
      ...(startsAt ? { startsAt } : {}),
    },
  };
}

/**
 * `today` is not used by the wording — it never was — but `daysAway` cannot be
 * derived without it, and deriving it anywhere but here would let the fields
 * and the prose drift apart. Both callers already hold the owner's local day.
 */
export function cadenceMessage(person: string, dueDay: PlainDate, today: PlainDate): ReminderMessage {
  return {
    subject: `Time to reach out to ${person}`,
    body: `${person}'s keep-in-touch cadence has been due since ${plainDateKey(dueDay)}.`,
    data: {
      policy: "OVERDUE_CADENCE",
      date: plainDateKey(dueDay),
      daysAway: diffPlainDays(today, dueDay),
      contactName: person,
    },
  };
}

export function taskMessage(
  title: string,
  person: string | null,
  dueDay: PlainDate,
  today: PlainDate,
): ReminderMessage {
  return {
    subject: `Task due: ${title}`,
    body: `${title}${person ? ` for ${person}` : ""} was due ${plainDateKey(dueDay)}.`,
    data: {
      policy: "INCOMPLETE_TASK_DUE",
      date: plainDateKey(dueDay),
      daysAway: diffPlainDays(today, dueDay),
      title,
      ...(person ? { contactName: person } : {}),
    },
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
  | { kind: "PLAN"; title: string; contactName: string | null; date: PlainDate }
);

/** Kept deliberately small enough for the most restrictive supported push channel. */
export const DIGEST_ENTRY_LIMIT = 20;

function digestTiming(item: DigestItem, today: PlainDate): DigestTiming {
  const days = diffPlainDays(today, item.date);
  return days < 0 ? "overdue" : days === 0 ? "due today" : "upcoming";
}

/** The same entry the body prints, in fields. Nothing here is new. */
function digestDataItem(item: DigestItem, today: PlainDate): ReminderDataItem {
  return {
    kind: item.kind,
    ...(item.kind === "IMPORTANT_DATE" ? { label: item.label } : {}),
    ...(item.kind === "TASK" || item.kind === "PLAN" ? { title: item.title } : {}),
    ...(item.contactName ? { contactName: item.contactName } : {}),
    date: plainDateKey(item.date),
    timing: digestTiming(item, today),
  };
}

function digestEntry(item: DigestItem, today: PlainDate): string {
  const timing = digestTiming(item, today);
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
  // Plans lead: an evening you have actually arranged is the one thing in here
  // with a time and a person waiting on it.
  const kindOrder: DigestItem["kind"][] = ["PLAN", "IMPORTANT_DATE", "CADENCE", "TASK"];
  const headings: Record<DigestItem["kind"], string> = {
    PLAN: "Arranged",
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
    data: {
      policy: "DAILY_DIGEST",
      date: plainDateKey(today),
      daysAway: 0,
      // Only what the body listed. Sending the entries the cap dropped would
      // put names on the wire that the message itself does not mention.
      items: shown.map((item) => digestDataItem(item, today)),
      hiddenItems: hidden,
    },
  };
}

function compareDigestDates(a: PlainDate, b: PlainDate): number {
  return plainDateKey(a).localeCompare(plainDateKey(b));
}
