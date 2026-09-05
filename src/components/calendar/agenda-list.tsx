import { type PlainMonth, groupByDay, isInMonth, monthGridDays } from "@/lib/calendar-grid";
import type { WeekStart } from "@/lib/calendar-grid";
import { type PlainDate, plainDateKey } from "@/lib/dates";
import { formatPartialDate } from "@/lib/date-precision";
import { relativeDay } from "@/lib/format";
import type { CalendarEntry } from "@/server/queries/calendar";
import { EntryChip, KIND_LABEL, displayName } from "@/components/calendar/entry-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";

/**
 * The month as a list of the days that hold something. The phone's view of the
 * calendar, and the accessible reading of the same data on any screen.
 *
 * Only days with entries appear — a phone showing 31 headings, 26 of them
 * empty, is a worse answer than a grid. Days from the neighbouring months are
 * left out here even though the grid draws them: the grid needs full weeks to
 * be a grid, and a list does not.
 */
export function AgendaList({
  month,
  weekStartsOn,
  entries,
  today,
}: {
  month: PlainMonth;
  weekStartsOn: WeekStart;
  entries: CalendarEntry[];
  today: PlainDate;
}) {
  const byDay = groupByDay(entries, (entry) => entry.day);
  const days = monthGridDays(month, weekStartsOn).filter(
    (day) => isInMonth(day, month) && (byDay.get(plainDateKey(day))?.length ?? 0) > 0,
  );

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="CalendarDays" />}
        title="Nothing this month"
        description="Plans, birthdays, follow-ups and anything you have logged will show up here."
        compact
      />
    );
  }

  return (
    <ol className="grid min-w-0 gap-3">
      {days.map((day) => {
        const key = plainDateKey(day);
        const dayEntries = byDay.get(key) ?? [];
        return (
          <li key={key} className="grid min-w-0 gap-1.5">
            <h3 className="flex min-w-0 items-baseline gap-2 text-sm font-semibold tracking-tight">
              <span className="truncate">{formatPartialDate(day, "DAY", { weekday: true })}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {relativeDay(day, today, { short: true })}
              </span>
            </h3>
            <ul className="grid min-w-0 gap-1">
              {dayEntries.map((entry) => (
                <li key={entry.id} className="flex min-w-0 items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <EntryChip entry={entry} className="min-w-0 flex-1" />
                  {entry.contact ? (
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                      {displayName(entry.contact)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
