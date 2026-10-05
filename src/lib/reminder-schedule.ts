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
  /**
   * Birthdays whose year is known: the age reached on `date`. Already in the
   * body as "turning 40"; absent when the year was never given, rather than
   * worked out from a placeholder year.
   */
  age?: number;
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
  age?: number;
  title?: string;
  contactName?: string;
  date: string;
  timing: DigestTiming;
  /** Whole days from the digest's day to `date`; negative is overdue. */
  daysAway: number;
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

/**
 * How far past due something is, in whole days, for the things that can be:
 * a keep-in-touch cadence and a task. "12 days overdue" rather than the date
 * it fell due — the date asks the reader to do the subtraction, and the number
 * is what decides whether it can wait another day.
 */
function overdueWords(days: number): string {
  const late = -days;
  return late <= 0 ? "due today" : `${late} ${late === 1 ? "day" : "days"} overdue`;
}

/** "in 5 days", "tomorrow", "today" — for entries that have not happened yet. */
function aheadWords(days: number): string {
  return (
    days === 0 ? "today"
    : days === 1 ? "tomorrow"
    : days > 1 ? `in ${days} days`
    : days === -1 ? "yesterday"
    : `${-days} days ago`
  );
}

/**
 * The age a birthday reaches on `occurrence`, or undefined when there is no
 * year to count from.
 *
 * The occurrence's year minus the birth year, not `yearsBetween`: a 29
 * February birthday is observed on the 28th in a common year, and counting
 * whole years up to that day would make the person a year younger on the day
 * they are being congratulated for getting older.
 */
export function ageOn(birthYear: number | undefined, occurrence: PlainDate): number | undefined {
  if (birthYear === undefined) return undefined;
  const age = occurrence.year - birthYear;
  return age > 0 ? age : undefined;
}

function ageWords(age: number | undefined, days: number): string {
  if (age === undefined) return "";
  return days < 0 ? `, turned ${age}` : `, turning ${age}`;
}

export function importantDateMessage(
  label: string,
  person: string,
  occurrence: PlainDate,
  today: PlainDate,
  age?: number,
): ReminderMessage {
  const days = diffPlainDays(today, occurrence);
  return {
    subject: `Reminder: ${label}`,
    body: `${label} for ${person} ${relativeWhen(days)} (${plainDateKey(occurrence)})${ageWords(age, days)}.`,
    data: {
      policy: "IMPORTANT_DATE_OFFSET",
      date: plainDateKey(occurrence),
      daysAway: days,
      label,
      ...(age !== undefined ? { age } : {}),
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
  const days = diffPlainDays(today, dueDay);
  return {
    subject: `Time to reach out to ${person}`,
    body: `Reaching out to ${person} is ${overdueWords(days)} (due ${plainDateKey(dueDay)}).`,
    data: {
      policy: "OVERDUE_CADENCE",
      date: plainDateKey(dueDay),
      daysAway: days,
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
  const days = diffPlainDays(today, dueDay);
  return {
    subject: `Task due: ${title}`,
    body: `${title}${person ? ` for ${person}` : ""} is ${overdueWords(days)} (due ${plainDateKey(dueDay)}).`,
    data: {
      policy: "INCOMPLETE_TASK_DUE",
      date: plainDateKey(dueDay),
      daysAway: days,
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
  | { kind: "IMPORTANT_DATE"; label: string; contactName: string; date: PlainDate; age?: number }
  /**
   * An important date inside the "Coming up" window that no reminder policy
   * has reached yet. Its own kind rather than a flag on IMPORTANT_DATE so a
   * reader of the fields can tell "a reminder is owed about this" from "this
   * is on the horizon" — the two sections answer different questions.
   */
  | { kind: "UPCOMING_DATE"; label: string; contactName: string; date: PlainDate; age?: number }
  | { kind: "CADENCE"; contactName: string; date: PlainDate }
  | { kind: "TASK"; title: string; contactName: string | null; date: PlainDate }
  | { kind: "PLAN"; title: string; contactName: string | null; date: PlainDate }
);

/** Kept deliberately small enough for the most restrictive supported push channel. */
export const DIGEST_ENTRY_LIMIT = 20;

/**
 * How far ahead the digest's "Coming up" section looks for important dates.
 *
 * Two weeks: long enough to get a card in the post or book a table, short
 * enough that a daily message is not mostly a list of the same far-off dates.
 */
export const COMING_UP_DAYS = 14;

function digestTiming(item: DigestItem, today: PlainDate): DigestTiming {
  const days = diffPlainDays(today, item.date);
  return days < 0 ? "overdue" : days === 0 ? "due today" : "upcoming";
}

/** The same entry the body prints, in fields. Nothing here is new. */
function digestDataItem(item: DigestItem, today: PlainDate): ReminderDataItem {
  const dated = item.kind === "IMPORTANT_DATE" || item.kind === "UPCOMING_DATE";
  return {
    kind: item.kind,
    ...(dated ? { label: item.label } : {}),
    ...(dated && item.age !== undefined ? { age: item.age } : {}),
    ...(item.kind === "TASK" || item.kind === "PLAN" ? { title: item.title } : {}),
    ...(item.contactName ? { contactName: item.contactName } : {}),
    date: plainDateKey(item.date),
    timing: digestTiming(item, today),
    daysAway: diffPlainDays(today, item.date),
  };
}

/**
 * One line of the digest.
 *
 * What is late says by how much — "12 days overdue" — and drops the date,
 * which only asked the reader to work that out. What is still ahead keeps its
 * date beside "in 5 days", because that is the line someone acts on by
 * looking at a calendar.
 */
function digestEntry(item: DigestItem, today: PlainDate): string {
  const days = diffPlainDays(today, item.date);
  const detail = item.kind === "IMPORTANT_DATE" || item.kind === "UPCOMING_DATE"
    ? `${item.label} — ${item.contactName}${ageWords(item.age, days)}`
    : item.kind === "CADENCE"
      ? item.contactName
      : `${item.title}${item.contactName ? ` — ${item.contactName}` : ""}`;
  // Only a cadence or a task is *owed*, so only they are "due" or "overdue";
  // an evening or a birthday is simply today.
  const owed = item.kind === "CADENCE" || item.kind === "TASK";
  const when = days > 0
    ? `${aheadWords(days)}, ${plainDateKey(item.date)}`
    : owed
      ? overdueWords(days)
      : aheadWords(days);
  return `- ${detail} (${when})`;
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
  // "Coming up" closes the digest: it is the horizon, read after what needs
  // doing. Every entry in it is a preview, so the cap trims it first.
  const kindOrder: DigestItem["kind"][] = ["PLAN", "IMPORTANT_DATE", "CADENCE", "TASK", "UPCOMING_DATE"];
  const headings: Record<DigestItem["kind"], string> = {
    PLAN: "Arranged",
    IMPORTANT_DATE: "Important dates",
    CADENCE: "Keep in touch",
    TASK: "Tasks",
    UPCOMING_DATE: `Coming up (next ${COMING_UP_DAYS} days)`,
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
