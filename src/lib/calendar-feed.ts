/**
 * Turning calendar entries into subscribable events.
 *
 * The grid and the feed answer to different shapes. A grid has squares, so a
 * fortnight away is a chip on each of fourteen of them; a calendar client
 * understands a span, so the days are folded back into one event here. A grid
 * has no length, so a plan at seven is just a chip in Friday's square; a client
 * wants a start and possibly an end.
 *
 * Deliberately structural rather than importing `CalendarEntry` from the query
 * layer: `src/lib` stays free of anything that reaches a database, and
 * `CalendarEntry` satisfies this interface by shape.
 */
import { plainDateKey, zonedTimeOfDay, type PlainDate } from "@/lib/dates";
import type { IcsEvent } from "@/lib/export/ics";

export type FeedKind = "plan" | "date" | "task" | "happening" | "interaction";

export interface FeedEntry {
  id: string;
  kind: FeedKind;
  day: PlainDate;
  title: string;
  contact: { firstName: string; lastName: string | null } | null;
  minute: number | null;
  durationMinutes: number | null;
  note: string | null;
}

/**
 * What a subscription carries.
 *
 * Interactions are left out: they are things that already happened, and a
 * calendar you subscribe to is for what is coming. They are also the one kind
 * whose entries would grow without bound as history accumulates.
 */
const FEED_KINDS: ReadonlySet<FeedKind> = new Set<FeedKind>([
  "plan",
  "date",
  "task",
  "happening",
]);

function displayName(contact: FeedEntry["contact"]): string | null {
  if (!contact) return null;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

/**
 * The line a calendar shows.
 *
 * A date's title is its bare label — "Birthday", "Anniversary" — which is
 * useless in a calendar that is not otherwise about this app. The person is
 * what makes it meaningful, so the name is folded in wherever the entry has
 * one and the title does not already carry it.
 */
function summaryFor(entry: FeedEntry): string {
  const name = displayName(entry.contact);
  if (!name) return entry.title;
  if (entry.title.includes(name)) return entry.title;
  return `${entry.title} — ${name}`;
}

/**
 * The stable half of an expanded entry's id.
 *
 * `getCalendarEntries` suffixes `@<day>` onto the kinds it expands — a
 * recurring date, a happening covering several days. Everything before it
 * identifies the row, which is what a UID has to be stable against so a
 * refetch updates the event rather than duplicating it.
 */
export function entryRowKey(id: string): string {
  const at = id.lastIndexOf("@");
  return at === -1 ? id : id.slice(0, at);
}

/**
 * Fold a happening's per-day entries back into the span it came from.
 *
 * Keyed on the row rather than the title: two people can be away under the
 * same words, and merging those would put one person's trip on the other's
 * dates. The days are already clamped to the window by the query, so the span
 * this recovers is the visible part of the trip, not necessarily the whole of
 * it — which is the right answer for a bounded feed.
 */
function foldSpans(entries: readonly FeedEntry[]): FeedEntry[] {
  const spans = new Map<string, { entry: FeedEntry; last: PlainDate }>();
  const out: FeedEntry[] = [];

  for (const entry of entries) {
    if (entry.kind !== "happening") {
      out.push(entry);
      continue;
    }
    const key = entryRowKey(entry.id);
    const seen = spans.get(key);
    if (!seen) {
      const span = { entry: { ...entry, id: key }, last: entry.day };
      spans.set(key, span);
      out.push(span.entry);
      continue;
    }
    // Entries arrive sorted by day, but the comparison is done rather than
    // assumed: a fold that trusts the order silently shortens a trip if the
    // caller ever sorts differently.
    if (plainDateKey(entry.day) > plainDateKey(seen.last)) seen.last = entry.day;
    if (plainDateKey(entry.day) < plainDateKey(seen.entry.day)) seen.entry.day = entry.day;
  }

  return out.map((entry) => {
    if (entry.kind !== "happening") return entry;
    const span = spans.get(entry.id);
    return span && plainDateKey(span.last) !== plainDateKey(entry.day)
      ? { ...entry, lastDay: span.last }
      : entry;
  }) as FeedEntry[];
}

/** Internal: a folded happening carries the last day it covers. */
type Folded = FeedEntry & { lastDay?: PlainDate };

/**
 * Every entry a calendar client should see, as iCalendar events.
 *
 * `timezone` resolves a plan's local wall-clock minute into an instant. The
 * account's zone is the only correct one: the minute was recorded as a reading
 * off a clock in that zone, and resolving it anywhere else moves the
 * appointment.
 */
export function toFeedEvents(
  entries: readonly FeedEntry[],
  timezone: string,
): IcsEvent[] {
  const wanted = entries.filter((entry) => FEED_KINDS.has(entry.kind));

  return foldSpans(wanted).map((raw): IcsEvent => {
    const entry = raw as Folded;
    const base: IcsEvent = {
      uid: `personalcrm-${entry.id}`,
      summary: summaryFor(entry),
      description: entry.note,
      date: entry.day,
      // Every entry reaching here has already been placed on a real day by the
      // query, which drops anything too vague to put on a calendar. Saying DAY
      // is therefore a statement about this event, not an assumption about the
      // record behind it.
      precision: "DAY",
      // One-off. A recurring important date arrives already expanded into an
      // occurrence per year in the window, so emitting an RRULE as well would
      // put a second, endless copy of every birthday on top of the first.
      recurrence: "NONE",
    };

    if (entry.minute !== null) {
      const start = zonedTimeOfDay(entry.day, entry.minute, timezone);
      return {
        ...base,
        timed: {
          start,
          end:
            entry.durationMinutes && entry.durationMinutes > 0
              ? new Date(start.getTime() + entry.durationMinutes * 60_000)
              : undefined,
        },
      };
    }

    return entry.lastDay ? { ...base, lastDate: entry.lastDay } : base;
  });
}
