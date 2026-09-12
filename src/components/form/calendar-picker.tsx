"use client";

/**
 * A month grid you can click a day in.
 *
 * `src/components/calendar/month-grid.tsx` draws the calendar *page* — big
 * cells full of chips, every square a link. This is the small one that lives
 * inside a popover: seven columns of buttons and nothing else. They share
 * `src/lib/calendar-grid.ts` rather than the markup, because the arithmetic is
 * the part an off-by-one hides in and the layouts have nothing in common.
 *
 * Hand-rolled for the reason the page grid gives: seven equal columns is the
 * whole requirement, and a calendar library arrives with its own layout
 * assumptions to fight. Every column and cell carries `min-w-0`, because
 * `repeat(7, 1fr)` floors each track at `min-width: auto` and one wide cell
 * would push Saturday off a phone.
 *
 * Keyboard behaviour is the ARIA grid pattern: one tab stop for the whole
 * month, arrows to move, and moving past the edge follows into the next month
 * rather than stopping. A picker you can only reach with a pointer is a picker
 * half the people who need it most cannot use.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PlainMonth,
  type WeekStart,
  addPlainMonths,
  isInMonth,
  monthGridDays,
  monthOf,
  stepGridDay,
  weekdayOrder,
} from "@/lib/calendar-grid";
import { type PlainDate, plainDateKey } from "@/lib/dates";

/** Indexed by the weekday numbers `weekdayOf` returns, so Sunday first. */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * A plain date rendered through `Intl` without a timezone entering into it.
 * `Date.UTC` plus `timeZone: "UTC"` is the pair that keeps the two from
 * cancelling out wrongly — a local `Date` here would name the day before for
 * anyone west of Greenwich.
 */
function labelFor(date: PlainDate, options: Intl.DateTimeFormatOptions): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}

function monthLabel(month: PlainMonth): string {
  return labelFor({ ...month, day: 1 }, { month: "long", year: "numeric" });
}

/** Six rows of seven, as rows, because the ARIA grid pattern needs them. */
function weeksOf(month: PlainMonth, weekStartsOn: WeekStart): PlainDate[][] {
  const days = monthGridDays(month, weekStartsOn);
  return Array.from({ length: days.length / 7 }, (_, row) => days.slice(row * 7, row * 7 + 7));
}

/**
 * Put focus on the grid's single tab stop — the selected day, or today.
 *
 * The picker cannot do this itself on mount. A child effect runs before the
 * effects of the popover and drawer around it, so the focus scope it is landing
 * inside has not registered yet: the drawer still counts the grid as outside
 * itself and pulls focus straight back to whatever opened it. A container that
 * wants the calendar focused has to say so once its own focus scope has
 * settled, which for a Radix popover means `onOpenAutoFocus`.
 */
export function focusSelectedDay(root: HTMLElement | null): void {
  root?.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]')?.focus();
}

export function CalendarPicker({
  value,
  today,
  weekStartsOn = 0,
  onSelect,
  className,
}: {
  /** The selected day, if one is selected. */
  value: PlainDate | null;
  today: PlainDate;
  weekStartsOn?: WeekStart;
  onSelect: (date: PlainDate) => void;
  className?: string;
}) {
  const captionId = React.useId();
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [month, setMonth] = React.useState<PlainMonth>(() => monthOf(value ?? today));
  const [focused, setFocused] = React.useState<PlainDate>(() => value ?? today);

  const valueKey = value ? plainDateKey(value) : null;
  const todayKey = plainDateKey(today);
  const focusedKey = plainDateKey(focused);

  // Follow a selection made somewhere else — a preset chip, or the text field
  // this picker hangs off. Without it the grid keeps showing the month it was
  // opened on while the field underneath reads a different one.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before touching the DOM, so the grid is only ever painted on the
  // right month. An effect would paint the stale one first and correct it, and
  // on a month change that is a visible flash of the wrong calendar.
  const [seenValueKey, setSeenValueKey] = React.useState(valueKey);
  if (value && valueKey !== seenValueKey) {
    setSeenValueKey(valueKey);
    setMonth(monthOf(value));
    setFocused(value);
  }

  /**
   * Move the real focus, not just the roving `tabIndex`.
   *
   * Only when a keystroke asked for it: an effect that focused on every change
   * of `focused` would also fire when a click set it, taking focus back off
   * whatever the click moved to.
   */
  const takeFocus = React.useRef(false);
  React.useEffect(() => {
    if (!takeFocus.current) return;
    takeFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedKey}"]`)?.focus();
  }, [focusedKey]);

  function moveFocus(next: PlainDate) {
    takeFocus.current = true;
    setFocused(next);
    if (!isInMonth(next, month)) setMonth(monthOf(next));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = stepGridDay(focused, event.key, weekStartsOn);
    if (!next) return;
    event.preventDefault();
    moveFocus(next);
  }

  function stepMonth(delta: number) {
    const next = addPlainMonths(month, delta);
    setMonth(next);
    // Keep the tab stop on a square that is actually on screen, and keep the
    // same weekday-of-month feel by moving the focused day with the header.
    setFocused((current) => {
      const step = stepGridDay(current, delta < 0 ? "PageUp" : "PageDown", weekStartsOn);
      return step && isInMonth(step, next) ? step : { ...next, day: 1 };
    });
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-1">
        <MonthButton label="Previous month" onClick={() => stepMonth(-1)}>
          <ChevronLeft className="size-4" />
        </MonthButton>
        {/* Announced on change so a screen reader hears the month it landed in
            when the arrows walk past the end of one. */}
        <div id={captionId} aria-live="polite" className="text-sm font-medium">
          {monthLabel(month)}
        </div>
        <MonthButton label="Next month" onClick={() => stepMonth(1)}>
          <ChevronRight className="size-4" />
        </MonthButton>
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-labelledby={captionId}
        onKeyDown={onKeyDown}
        className="grid min-w-0 gap-0.5"
      >
        <div role="row" className="grid min-w-0 grid-cols-7">
          {weekdayOrder(weekStartsOn).map((weekday) => (
            <div
              key={weekday}
              role="columnheader"
              aria-label={WEEKDAY_NAMES[weekday]}
              className="min-w-0 truncate pb-1 text-center text-[11px] font-medium text-muted-foreground"
            >
              {WEEKDAY_ABBR[weekday]}
            </div>
          ))}
        </div>

        {weeksOf(month, weekStartsOn).map((week) => (
          <div key={plainDateKey(week[0])} role="row" className="grid min-w-0 grid-cols-7">
            {week.map((day) => {
              const key = plainDateKey(day);
              const selected = key === valueKey;
              const outside = !isInMonth(day, month);
              return (
                <div key={key} role="gridcell" aria-selected={selected} className="min-w-0">
                  <button
                    type="button"
                    data-day={key}
                    // One tab stop for the whole month: Tab reaches the grid,
                    // arrows move inside it, Tab leaves. Forty-two tab stops is
                    // the alternative, and nobody tabs through those.
                    tabIndex={key === focusedKey ? 0 : -1}
                    aria-label={labelFor(day, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                    aria-current={key === todayKey ? "date" : undefined}
                    onClick={() => {
                      setFocused(day);
                      if (outside) setMonth(monthOf(day));
                      onSelect(day);
                    }}
                    className={cn(
                      "flex h-9 w-full min-w-0 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      // Full tokens, no opacity: a translucent foreground over
                      // a background nothing predicts is how the page grid's
                      // day numbers once measured 4.36 against 4.5.
                      outside ? "text-muted-foreground" : "text-foreground",
                      selected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "hover:bg-muted",
                      key === todayKey && !selected && "ring-1 ring-inset ring-accent-8",
                    )}
                  >
                    {day.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
