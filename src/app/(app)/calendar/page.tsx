import type { Metadata } from "next";
import Link from "next/link";
import { getUserContext } from "@/server/user/context";
import { getCalendarEntries } from "@/server/queries/calendar";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { MonthGrid } from "@/components/calendar/month-grid";
import { AgendaList, DayEntries } from "@/components/calendar/agenda-list";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";
import {
  type PlainMonth,
  type WeekStart,
  addPlainMonths,
  monthGridWindow,
  monthOf,
  parsePlainMonth,
  plainMonthKey,
} from "@/lib/calendar-grid";
import { groupByDay, isWithin } from "@/lib/calendar-grid";
import { formatPartialDate } from "@/lib/date-precision";
import { plainDateKey, parsePlainDate, todayInTz } from "@/lib/dates";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(month: PlainMonth): string {
  return `${MONTHS[month.month - 1]} ${month.year}`;
}

/**
 * Everything dated, on one page.
 *
 * The month is a URL parameter rather than component state, so a particular
 * month is a link somebody can send, a back button works, and the whole page
 * stays a server component — no client data store, matching the rest of the
 * app. Navigation is three ordinary links.
 *
 * Deliberately read-only. Tapping an entry goes to the thing; nothing is
 * created or edited from here. Editing in a grid cell is a second interaction
 * model to get right on a phone, and it is not what a calendar is for.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, prefs, timezone } = await getUserContext();
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const requested = parsePlainMonth(first("month"));

  // Today is the account's today, not the server's — invariant 2. It decides
  // the default month and which square is highlighted.
  const today = todayInTz(timezone);
  const month = requested ?? monthOf(today);

  // 0 = Sunday, 1 = Monday; anything else in the column is a hand-edited row.
  const weekStartsOn: WeekStart = prefs.weekStartsOn === 1 ? 1 : 0;

  // The window is the grid's, not the month's: the first and last rows show
  // days from the neighbouring months, and they would render empty while
  // holding something if the query were asked only for the month.
  const window = monthGridWindow(month, weekStartsOn);

  const [entries, cacheable] = await Promise.all([
    getCalendarEntries(user.id, timezone, window),
    offlineCacheable(user.id),
  ]);

  // A day the grid links into, shown in full underneath it. Ignored unless it
  // is one of the days actually drawn, so a hand-typed date cannot ask the page
  // for something the query was never given.
  const askedFor = parsePlainDate(first("day") ?? "");
  const selected = askedFor && isWithin(askedFor, window) ? askedFor : null;
  const selectedEntries = selected
    ? (groupByDay(entries, (entry) => entry.day).get(plainDateKey(selected)) ?? [])
    : [];

  const previous = plainMonthKey(addPlainMonths(month, -1));
  const next = plainMonthKey(addPlainMonths(month, 1));
  const isThisMonth = month.year === today.year && month.month === today.month;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Calendar</h2>
          <p className="text-xs text-muted-foreground">
            Plans, birthdays and important dates, follow-ups, what people have on, and everything
            you have logged.
          </p>
        </div>
        {/* `<Button asChild>` rather than `buttonVariants(...)` applied to a
            plain link. `button.tsx` is a client module, so its exports reach a
            server component as client references — rendering the component is
            fine, but *calling* one of its functions here throws at request
            time, which builds clean and 500s live. Every other server page
            that wants a link shaped like a button does it this way. */}
        <nav aria-label="Change month" className="flex shrink-0 items-center gap-1">
          <Button asChild variant="outline" size="icon-sm" aria-label="Previous month">
            <Link href={`/calendar?month=${previous}`}>
              <Icon name="ChevronLeft" />
            </Link>
          </Button>
          {isThisMonth ? null : (
            <Button asChild variant="outline" size="sm">
              <Link href="/calendar">Today</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="icon-sm" aria-label="Next month">
            <Link href={`/calendar?month=${next}`}>
              <Icon name="ChevronRight" />
            </Link>
          </Button>
        </nav>
      </div>

      <section aria-labelledby="calendar-month-heading" className="grid min-w-0 gap-3">
        <h3 id="calendar-month-heading" className="text-sm font-semibold tracking-tight">
          {monthLabel(month)}
        </h3>

        {/* Two readings of the same entries. The grid is the desktop answer and
            the agenda is the phone's; the agenda is also the one a screen
            reader gets a useful sequence out of, which is why it names each
            entry's kind in words rather than leaving colour to say it. */}
        <MonthGrid
          month={month}
          weekStartsOn={weekStartsOn}
          entries={entries}
          today={today}
          selected={selected}
          className="hidden lg:block"
        />

        <div className="lg:hidden">
          <AgendaList
            month={month}
            weekStartsOn={weekStartsOn}
            entries={entries}
            today={today}
          />
        </div>
      </section>

      {/* The day a cell was opened on, in full. The grid holds three entries
          to a square before it would start to scroll, so on a busy day this
          is the only place the rest of them exist. Rendered at every width:
          on a phone the month agenda is already complete, but a link into a
          particular day still has to lead somewhere. */}
      {selected ? (
        <section
          aria-labelledby="calendar-day-heading"
          className="grid min-w-0 gap-1.5 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <h3 id="calendar-day-heading" className="min-w-0 truncate text-sm font-semibold tracking-tight">
              {formatPartialDate(selected, "DAY", { weekday: true })}
            </h3>
            <Link
              href={`/calendar?month=${plainMonthKey(month)}`}
              className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Close
            </Link>
          </div>
          {selectedEntries.length > 0 ? (
            <DayEntries entries={selectedEntries} />
          ) : (
            <p className="text-xs text-muted-foreground">Nothing on this day.</p>
          )}
        </section>
      ) : null}

      {/* Keyed by the month and day, so stepping between them remounts it.
          Month and day navigation only changes the search parameters, so the
          App Router keeps this component mounted while it reconciles the new
          server result — and its effect reads the URL once, on mount. The
          service worker stores exact URLs, so without the key only the first
          calendar page anybody opened was ever offered offline and every
          other month fell through to the generic offline screen. */}
      {cacheable ? (
        <CacheThisPage
          key={`${plainMonthKey(month)}:${selected ? plainDateKey(selected) : ""}`}
        />
      ) : null}
    </div>
  );
}
