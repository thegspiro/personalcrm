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
    // A typed URL rather than a navigation. Answering null sends it to today.
    expect(parsePlainMonth("0000-05")).toBeNull();
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
