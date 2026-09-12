import { describe, expect, it } from "vitest";
import {
  CALENDAR_WEEKS,
  addPlainMonths,
  endOfPlainMonth,
  groupByDay,
  isInMonth,
  isWithin,
  monthGridDays,
  monthGridWindow,
  parsePlainMonth,
  stepGridDay,
  plainMonthKey,
  weekdayOf,
  weekdayOrder,
} from "@/lib/calendar-grid";
import { plainDateKey } from "@/lib/dates";

/**
 * The grid arithmetic, on its own.
 *
 * A calendar off by one day is invisible to every type check and obvious to
 * every user, so these cases pin the edges: the months that need six rows, the
 * ones that start exactly on the first column, and the year boundaries a
 * month-stepper walks over.
 */
describe("month keys", () => {
  it("round-trips a month through its key", () => {
    expect(plainMonthKey({ year: 2026, month: 3 })).toBe("2026-03");
    expect(parsePlainMonth("2026-03")).toEqual({ year: 2026, month: 3 });
  });

  it("refuses anything that is not a month", () => {
    expect(parsePlainMonth(undefined)).toBeNull();
    expect(parsePlainMonth("")).toBeNull();
    expect(parsePlainMonth("2026-13")).toBeNull();
    expect(parsePlainMonth("2026-00")).toBeNull();
    expect(parsePlainMonth("2026-3")).toBeNull();
    expect(parsePlainMonth("not-a-month")).toBeNull();
  });

  it("refuses years that would be reinterpreted or could not be stored", () => {
    // `Date.UTC(50, ...)` is 1950, so a two-digit year would head the page
    // "March 50" while every cell underneath said 1950.
    expect(parsePlainMonth("0050-03")).toBeNull();
    expect(parsePlainMonth("0000-05")).toBeNull();
    // The six-week grid overruns its month by a few days at each end, so the
    // very edges of MariaDB's DATE range are out too.
    expect(parsePlainMonth("1000-01")).toBeNull();
    expect(parsePlainMonth("9999-12")).toBeNull();
    // Accepted by the parser, and safe because the query clamps its own
    // reach-back: the grid for this month starts in December 1000, and the
    // prefilters widen it another year past that.
    expect(parsePlainMonth("1001-01")).toEqual({ year: 1001, month: 1 });
    expect(parsePlainMonth("9998-12")).toEqual({ year: 9998, month: 12 });
  });
});

describe("stepping months", () => {
  it("walks forwards over a year boundary", () => {
    expect(addPlainMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("walks backwards over a year boundary", () => {
    expect(addPlainMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("walks more than a year in either direction", () => {
    expect(addPlainMonths({ year: 2026, month: 5 }, 14)).toEqual({ year: 2027, month: 7 });
    expect(addPlainMonths({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
  });

  it("knows the last day of a month, including a leap February", () => {
    expect(endOfPlainMonth({ year: 2026, month: 2 })).toEqual({ year: 2026, month: 2, day: 28 });
    expect(endOfPlainMonth({ year: 2028, month: 2 })).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe("the grid", () => {
  it("is always six full weeks, so the page does not jump between months", () => {
    for (const month of [
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 8 },
    ]) {
      expect(monthGridDays(month, 0)).toHaveLength(CALENDAR_WEEKS * 7);
      expect(monthGridDays(month, 1)).toHaveLength(CALENDAR_WEEKS * 7);
    }
  });

  it("starts on the account's first weekday", () => {
    // 1 March 2026 is a Sunday.
    expect(weekdayOf({ year: 2026, month: 3, day: 1 })).toBe(0);

    const sundayFirst = monthGridDays({ year: 2026, month: 3 }, 0);
    expect(sundayFirst[0]).toEqual({ year: 2026, month: 3, day: 1 });

    // Monday-first has to lead with the whole previous week, not drop a day.
    const mondayFirst = monthGridDays({ year: 2026, month: 3 }, 1);
    expect(mondayFirst[0]).toEqual({ year: 2026, month: 2, day: 23 });
    expect(mondayFirst[6]).toEqual({ year: 2026, month: 3, day: 1 });
  });

  it("every row is seven consecutive days, with no gap at a month boundary", () => {
    const days = monthGridDays({ year: 2026, month: 2 }, 1);
    for (let index = 1; index < days.length; index++) {
      const previous = Date.UTC(days[index - 1].year, days[index - 1].month - 1, days[index - 1].day);
      const current = Date.UTC(days[index].year, days[index].month - 1, days[index].day);
      expect(current - previous).toBe(86_400_000);
    }
  });

  it("contains every day of the month it is drawing", () => {
    const days = monthGridDays({ year: 2026, month: 5 }, 0).filter((day) =>
      isInMonth(day, { year: 2026, month: 5 }),
    );
    expect(days).toHaveLength(31);
    expect(days[0].day).toBe(1);
    expect(days[30].day).toBe(31);
  });

  it("the window covers the leading and trailing squares, not just the month", () => {
    const window = monthGridWindow({ year: 2026, month: 3 }, 1);
    // Leading days belong to February, trailing days to April — both are drawn,
    // so both have to be fetched or they render empty while holding something.
    expect(window.from).toEqual({ year: 2026, month: 2, day: 23 });
    expect(window.to).toEqual({ year: 2026, month: 4, day: 5 });
    expect(isWithin({ year: 2026, month: 2, day: 23 }, window)).toBe(true);
    expect(isWithin({ year: 2026, month: 2, day: 22 }, window)).toBe(false);
    expect(isWithin({ year: 2026, month: 4, day: 6 }, window)).toBe(false);
  });

  it("rotates the weekday headings to match", () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("grouping", () => {
  it("buckets by day in one pass, keeping order within a day", () => {
    const items = [
      { name: "a", day: { year: 2026, month: 3, day: 2 } },
      { name: "b", day: { year: 2026, month: 3, day: 1 } },
      { name: "c", day: { year: 2026, month: 3, day: 2 } },
    ];
    const grouped = groupByDay(items, (item) => item.day);
    expect(grouped.get(plainDateKey({ year: 2026, month: 3, day: 2 }))?.map((i) => i.name)).toEqual(
      ["a", "c"],
    );
    expect(grouped.get(plainDateKey({ year: 2026, month: 3, day: 1 }))?.map((i) => i.name)).toEqual(
      ["b"],
    );
    expect(grouped.get("2026-03-03")).toBeUndefined();
  });
});

/**
 * Arrow keys, at the edges.
 *
 * Every interesting case leaves the month being shown, and a grid that refuses
 * to is a grid you cannot reach last month with. `weekStartsOn` only changes
 * the two row-end keys, so both settings are checked on the same day.
 */
describe("keyboard navigation", () => {
  const midMonth = { year: 2026, month: 9, day: 11 }; // A Friday.

  it("steps a day and a week in each direction", () => {
    expect(stepGridDay(midMonth, "ArrowLeft", 0)).toEqual({ year: 2026, month: 9, day: 10 });
    expect(stepGridDay(midMonth, "ArrowRight", 0)).toEqual({ year: 2026, month: 9, day: 12 });
    expect(stepGridDay(midMonth, "ArrowUp", 0)).toEqual({ year: 2026, month: 9, day: 4 });
    expect(stepGridDay(midMonth, "ArrowDown", 0)).toEqual({ year: 2026, month: 9, day: 18 });
  });

  it("walks out of the month rather than stopping at its edge", () => {
    expect(stepGridDay({ year: 2026, month: 9, day: 1 }, "ArrowLeft", 0)).toEqual({
      year: 2026,
      month: 8,
      day: 31,
    });
    expect(stepGridDay({ year: 2026, month: 12, day: 31 }, "ArrowRight", 0)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(stepGridDay({ year: 2026, month: 1, day: 3 }, "ArrowUp", 0)).toEqual({
      year: 2025,
      month: 12,
      day: 27,
    });
  });

  it("takes Home and End to the ends of the row the account actually sees", () => {
    // Friday the 11th: Sunday-first that row runs the 6th to the 12th,
    // Monday-first it runs the 7th to the 13th.
    expect(stepGridDay(midMonth, "Home", 0)).toEqual({ year: 2026, month: 9, day: 6 });
    expect(stepGridDay(midMonth, "End", 0)).toEqual({ year: 2026, month: 9, day: 12 });
    expect(stepGridDay(midMonth, "Home", 1)).toEqual({ year: 2026, month: 9, day: 7 });
    expect(stepGridDay(midMonth, "End", 1)).toEqual({ year: 2026, month: 9, day: 13 });
  });

  it("steps whole months, keeping the day where the month is long enough", () => {
    expect(stepGridDay(midMonth, "PageUp", 0)).toEqual({ year: 2026, month: 8, day: 11 });
    expect(stepGridDay(midMonth, "PageDown", 0)).toEqual({ year: 2026, month: 10, day: 11 });
    // The 31st has nowhere to be in a thirty-day month, and nowhere at all in
    // February. Clamping is what every other date calculation here does.
    expect(stepGridDay({ year: 2026, month: 3, day: 31 }, "PageUp", 0)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(stepGridDay({ year: 2026, month: 1, day: 31 }, "PageDown", 0)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(stepGridDay({ year: 2026, month: 1, day: 15 }, "PageUp", 0)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });

  it("answers null for a key the grid does not own, so it keeps bubbling", () => {
    // Tab, Escape and Enter all have to reach the popover around it.
    for (const key of ["Tab", "Escape", "Enter", " ", "a"]) {
      expect(stepGridDay(midMonth, key, 0)).toBeNull();
    }
  });
});
