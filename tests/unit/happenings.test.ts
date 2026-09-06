import { describe, expect, it } from "vitest";
import {
  TASK_TITLE_MAX,
  followUpDueDate,
  followUpTaskTitle,
  happeningPhase,
  happeningSpan,
  type HappeningDates,
} from "@/lib/happenings";
import { plainDateKey } from "@/lib/dates";
import type { DatePrecision } from "@/lib/date-precision";

const on = (
  key: string,
  precision: DatePrecision = "DAY",
  end?: string,
  endPrecision: DatePrecision = "DAY",
): HappeningDates => {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  };
  return {
    date: parse(key),
    precision,
    endDate: end ? parse(end) : null,
    endPrecision: end ? endPrecision : null,
  };
};

describe("happeningSpan", () => {
  it("widens a vague date to the whole period it could mean", () => {
    // "Sometime in October" is the month, not the 1st. Treating the anchor as
    // the answer is what turns a partial date into a confident-looking lie.
    const span = happeningSpan(on("2026-10-01", "MONTH"));
    expect(plainDateKey(span.start)).toBe("2026-10-01");
    expect(plainDateKey(span.end)).toBe("2026-10-31");
  });

  it("runs from the start of a vague start to the end of a vague end", () => {
    const span = happeningSpan(on("2026-10-01", "MONTH", "2026-11-01", "MONTH"));
    expect(plainDateKey(span.start)).toBe("2026-10-01");
    expect(plainDateKey(span.end)).toBe("2026-11-30");
  });

  it("falls back to the start when a stored end precedes it", () => {
    // The action refuses this, but a row edited in the database directly should
    // still render as a day rather than as an empty interval.
    const span = happeningSpan(on("2026-10-10", "DAY", "2026-10-01"));
    expect(plainDateKey(span.start)).toBe("2026-10-10");
    expect(plainDateKey(span.end)).toBe("2026-10-10");
  });
});

describe("happeningPhase", () => {
  const trip = on("2026-09-12", "DAY", "2026-09-19");

  it("counts both ends as under way", () => {
    expect(happeningPhase(trip, { year: 2026, month: 9, day: 12 })).toBe("ongoing");
    expect(happeningPhase(trip, { year: 2026, month: 9, day: 19 })).toBe("ongoing");
  });

  it("is upcoming the day before and ended the day after", () => {
    expect(happeningPhase(trip, { year: 2026, month: 9, day: 11 })).toBe("upcoming");
    expect(happeningPhase(trip, { year: 2026, month: 9, day: 20 })).toBe("ended");
  });

  it("keeps a whole-month happening current in the middle of the month", () => {
    // The anchor is the 1st; a naive comparison would call this over on the 2nd.
    const vague = on("2026-10-01", "MONTH");
    expect(happeningPhase(vague, { year: 2026, month: 10, day: 20 })).toBe("ongoing");
    expect(happeningPhase(vague, { year: 2026, month: 11, day: 1 })).toBe("ended");
  });

  it("treats a single day as one day, not an open end", () => {
    const day = on("2026-09-12");
    expect(happeningPhase(day, { year: 2026, month: 9, day: 12 })).toBe("ongoing");
    expect(happeningPhase(day, { year: 2026, month: 9, day: 13 })).toBe("ended");
  });
});

describe("followUpDueDate", () => {
  it("asks the day after a dated trip ends", () => {
    expect(plainDateKey(followUpDueDate(on("2026-09-12", "DAY", "2026-09-19")))).toBe(
      "2026-09-20",
    );
  });

  it("asks the day after a single-day happening", () => {
    expect(plainDateKey(followUpDueDate(on("2026-09-12")))).toBe("2026-09-13");
  });

  it("waits until the month is over for a month-precision happening", () => {
    // Following up on 2 October would be asking about a trip they have not
    // taken yet — the exact failure partial dates exist to prevent.
    expect(plainDateKey(followUpDueDate(on("2026-10-01", "MONTH")))).toBe("2026-11-01");
  });

  it("waits until the year is over for a year-precision happening", () => {
    expect(plainDateKey(followUpDueDate(on("2026-01-01", "YEAR")))).toBe("2027-01-01");
  });

  it("crosses a month and a leap-year boundary correctly", () => {
    expect(plainDateKey(followUpDueDate(on("2026-09-30")))).toBe("2026-10-01");
    expect(plainDateKey(followUpDueDate(on("2028-02-01", "MONTH")))).toBe("2028-03-01");
  });
});

describe("followUpTaskTitle", () => {
  it("names the happening so the task list reads without opening it", () => {
    expect(followUpTaskTitle("Trip to Portugal")).toBe("Ask how “Trip to Portugal” went");
  });

  it("trims surrounding whitespace rather than storing it", () => {
    expect(followUpTaskTitle("  Trip  ")).toBe("Ask how “Trip” went");
  });

  it("clamps to the column width, keeping the question intact", () => {
    // Task.title is VARCHAR(191); an over-long title would fail the insert.
    const title = followUpTaskTitle("x".repeat(400));
    expect(title.length).toBeLessThanOrEqual(TASK_TITLE_MAX);
    expect(title.startsWith("Ask how “")).toBe(true);
    expect(title.endsWith("” went")).toBe(true);
  });
});
