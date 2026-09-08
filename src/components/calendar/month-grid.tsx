import {
  type PlainMonth,
  type WeekStart,
  groupByDay,
  isInMonth,
  monthGridDays,
  plainMonthKey,
  weekdayOrder,
} from "@/lib/calendar-grid";
import Link from "next/link";
import { type PlainDate, plainDateKey } from "@/lib/dates";
import type { CalendarEntry } from "@/server/queries/calendar";
import { EntryChip } from "@/components/calendar/entry-chip";
import { cn } from "@/lib/utils";

/**
 * The month, as a grid. Desktop only — the agenda is the phone's answer.
 *
 * Hand-rolled rather than a calendar library: seven equal columns is the whole
 * requirement, and a library would arrive with its own layout assumptions to
 * fight. The one rule that matters is that every column and every cell carries
 * `min-w-0`, because `grid-template-columns: repeat(7, 1fr)` gives each track a
 * `min-width: auto` floor by default, so one long title in one cell widens the
 * whole table and pushes Saturday off the screen. `tests/e2e/layout.spec.ts`
 * asserts that never happens.
 */

/** Sunday-first, indexed by the weekday numbers `weekdayOf` returns. */
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Past this many in one square, the rest become a count. Four rows of chips
 * plus a counter is about what a cell can hold before the grid starts to
 * scroll, and a cell that scrolls is a cell nobody reads. */
const CHIPS_PER_DAY = 3;

export function MonthGrid({
  month,
  weekStartsOn,
  entries,
  today,
  selected,
  className,
}: {
  month: PlainMonth;
  weekStartsOn: WeekStart;
  entries: CalendarEntry[];
  today: PlainDate;
  /** The day whose full list is open below the grid, if any. */
  selected: PlainDate | null;
  className?: string;
}) {
  const days = monthGridDays(month, weekStartsOn);
  const byDay = groupByDay(entries, (entry) => entry.day);
  const todayKey = plainDateKey(today);
  const selectedKey = selected ? plainDateKey(selected) : null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="grid grid-cols-7 gap-px" role="presentation">
        {weekdayOrder(weekStartsOn).map((weekday) => (
          <div
            key={weekday}
            className="min-w-0 truncate px-1 pb-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {WEEKDAY_NAMES[weekday]}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {days.map((day) => {
          const key = plainDateKey(day);
          const dayEntries = byDay.get(key) ?? [];
          const shown = dayEntries.slice(0, CHIPS_PER_DAY);
          const hidden = dayEntries.length - shown.length;
          const outside = !isInMonth(day, month);
          return (
            <div
              key={key}
              // A real cell, not a table cell: the grid is presentational and
              // the entries inside it are the links. `min-h` keeps every row
              // the same height whether or not anything is on those days.
              className={cn(
                "grid min-h-24 min-w-0 content-start gap-0.5 p-1",
                // Opaque, not `bg-muted/40`. A translucent cell blends with
                // the grid lines behind it, which took the day number's
                // contrast to 4.36 against a background no token predicts —
                // and made it unfixable by looking at the tokens alone. Solid
                // keeps the neighbouring-month cells just as distinct and puts
                // the contrast back at a value the palette actually states.
                outside ? "bg-muted" : "bg-card",
              )}
            >
              <div className="flex min-w-0 items-baseline justify-between gap-1">
                {/* The date is a link even on an empty day, so opening a day is
                    one predictable target rather than something that appears
                    only when there is already something there. */}
                <Link
                  href={`/calendar?month=${plainMonthKey(month)}&day=${key}`}
                  aria-label={`Everything on ${key}`}
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums hover:underline",
                    key === todayKey
                      ? "bg-primary font-semibold text-primary-foreground"
                      : key === selectedKey
                        ? "bg-accent-3 font-semibold text-accent-11"
                        : // A day from the neighbouring month is already set
                          // apart by the cell's own background, so the number
                          // does not also need fading — at 60% of an already
                          // muted token it stopped clearing 4.5:1, which is
                          // the one thing a date has to do.
                          "text-muted-foreground",
                  )}
                >
                  {day.day}
                </Link>
              </div>
              {shown.map((entry) => (
                <EntryChip key={entry.id} entry={entry} />
              ))}
              {/* The overflow has to go somewhere. A cell holds three before it
                  starts to scroll, and a count that cannot be opened is just a
                  way of hiding things — which is exactly what the first e2e run
                  caught, with a plan filed on a busy day and nowhere to see it. */}
              {hidden > 0 ? (
                <Link
                  href={`/calendar?month=${plainMonthKey(month)}&day=${key}`}
                  className="px-1 text-[11px] text-muted-foreground hover:underline"
                >
                  +{hidden} more
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
