import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { buildTimeline, type TimelineKind } from "@/server/queries/timeline";
import { TimelineList } from "@/components/timeline/timeline-list";
import { TimelineFilters } from "@/components/timeline/timeline-filters";
import { Pager } from "@/components/ui/pager";
import { describeFeedPage, pageWindow, parsePage } from "@/lib/pagination";
import { calendarDateInTz, parsePlainDate, plainDateToDb } from "@/lib/dates";
import { getUpcomingDates } from "@/server/queries/dashboard";
import { UpcomingDatesWidget } from "@/components/dashboard/widgets";
import { listTermsByKind } from "@/server/taxonomy/queries";

export const metadata: Metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

/** One more than this is fetched, so the page can tell a full list from a cut one. */
/**
 * How many entries a page of the timeline holds.
 *
 * The window the feed already drew. Paging it is an offset over a merged,
 * projected result rather than a SQL one, so each page costs the pages before
 * it — see `describeFeedPage`.
 */
const PAGE_SIZE = 100;

const VALID_KINDS = new Set<TimelineKind>([
  "interaction",
  "life-event",
  "important-date",
  "gift",
]);

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, prefs, timezone } = await getUserContext();
  const cacheable = await offlineCacheable(user.id);
  const params = await searchParams;

  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const kinds = (first("kinds") ?? "")
    .split(",")
    .filter((kind): kind is TimelineKind => VALID_KINDS.has(kind as TimelineKind));

  const fromPlain = first("from") ? parsePlainDate(first("from")!) : null;
  const toPlain = first("to") ? parsePlainDate(first("to")!) : null;

  const requested = parsePage(params.page);
  const window = pageWindow(requested, PAGE_SIZE);

  const [entryRows, upcomingDates, terms] = await Promise.all([
    buildTimeline(user.id, timezone, {
      kinds,
      search: first("q"),
      location: first("location"),
      locationId: first("locationId"),
      from: fromPlain ? plainDateToDb(fromPlain) : undefined,
      to: toPlain ? plainDateToDb(toPlain) : undefined,
      // Everything up to and including the page being asked for, plus the one
      // row that says whether another page follows. The merge and the
      // projections happen in memory, so there is no offset to push down into
      // the query.
      take: window.skip + window.take + 1,
    }),
    getUpcomingDates(user.id, timezone, 366, 100),
    listTermsByKind(user.id, ["DATE_TYPE", "LIFE_EVENT_TYPE"]),
  ]);

  const page = describeFeedPage(entryRows.length, requested, PAGE_SIZE);
  const entries = entryRows.slice(page.skip, page.skip + page.take);
  const today = calendarDateInTz(new Date(), timezone);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Timeline</h2>
        <p className="text-xs text-muted-foreground">
          History, newest first — recurring reminders are projected separately below.
        </p>
      </div>

      <TimelineFilters />

      <TimelineList
        entries={entries}
        today={today}
        timezone={timezone}
        dateTypes={terms.DATE_TYPE}
        lifeEventTypes={terms.LIFE_EVENT_TYPE}
        blurSensitive={prefs.blurPrivateNotes}
        emptyTitle="Nothing to show"
        emptyDescription="Log an interaction, or widen the filters."
      />

      <Pager info={page} pathname="/timeline" params={params} label="entries" />

      <UpcomingDatesWidget dates={upcomingDates} />
    </div>
  );
}
