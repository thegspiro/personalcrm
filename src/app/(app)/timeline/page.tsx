import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { buildTimeline, type TimelineKind } from "@/server/queries/timeline";
import { TimelineList } from "@/components/timeline/timeline-list";
import { TimelineFilters } from "@/components/timeline/timeline-filters";
import { calendarDateInTz, parsePlainDate, plainDateToDb } from "@/lib/dates";
import { listTermsByKind } from "@/server/taxonomy/queries";

export const metadata: Metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

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

  const [entries, terms] = await Promise.all([
    buildTimeline(user.id, timezone, {
      kinds,
      search: first("q"),
      from: fromPlain ? plainDateToDb(fromPlain) : undefined,
      to: toPlain ? plainDateToDb(toPlain) : undefined,
      take: 100,
    }),
    listTermsByKind(user.id, ["DATE_TYPE", "LIFE_EVENT_TYPE"]),
  ]);

  const today = calendarDateInTz(new Date(), timezone);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Timeline</h2>
        <p className="text-xs text-muted-foreground">
          Everything, newest first — including history you backfilled.
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
    </div>
  );
}
