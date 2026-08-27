import { describe, expect, it } from "vitest";
import {
  addPlainDays,
  calendarDateInTz,
  clampPlainDate,
  diffPlainDays,
  nextOccurrence,
  parsePlainDate,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  startOfDayInTz,
  yearsBetween,
  zonedStartOfDay,
} from "@/lib/dates";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

describe("calendarDateInTz", () => {
  it("puts a late-evening UTC instant on the previous day in New York", () => {
    // 2026-03-02T02:30Z is still 2026-03-01 21:30 in New York.
    const d = calendarDateInTz(new Date("2026-03-02T02:30:00Z"), NY);
    expect(plainDateKey(d)).toBe("2026-03-01");
  });

  it("puts an early-morning UTC instant on the next day in Tokyo", () => {
    const d = calendarDateInTz(new Date("2026-03-01T16:00:00Z"), TOKYO);
    expect(plainDateKey(d)).toBe("2026-03-02");
  });
});

describe("zonedStartOfDay", () => {
  it("resolves standard time correctly", () => {
    const start = zonedStartOfDay({ year: 2026, month: 1, day: 15 }, NY);
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("resolves daylight time correctly", () => {
    const start = zonedStartOfDay({ year: 2026, month: 7, day: 15 }, NY);
    expect(start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("handles the US spring-forward day, where the offset changes after midnight", () => {
    // DST begins 2026-03-08 at 02:00 local; midnight is still EST (-05:00).
    const start = zonedStartOfDay({ year: 2026, month: 3, day: 8 }, NY);
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("handles the US fall-back day", () => {
    const start = zonedStartOfDay({ year: 2026, month: 11, day: 1 }, NY);
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("round-trips through startOfDayInTz", () => {
    const instant = new Date("2026-07-15T18:45:00Z");
    expect(startOfDayInTz(instant, NY).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });
});

describe("plain date storage round-trip", () => {
  it("reads a DATE column without drifting a day", () => {
    // Prisma hands back UTC midnight for a DATE column.
    const fromDb = new Date("1991-06-05T00:00:00.000Z");
    expect(plainDateKey(plainDateFromDb(fromDb))).toBe("1991-06-05");
    expect(plainDateToDb(plainDateFromDb(fromDb)).toISOString()).toBe(fromDb.toISOString());
  });

  it("parses and rejects date keys", () => {
    expect(plainDateKey(parsePlainDate("2026-02-28")!)).toBe("2026-02-28");
    expect(parsePlainDate("2025-02-30")).toBeNull();
    expect(parsePlainDate("2026-13-01")).toBeNull();
    expect(parsePlainDate("nope")).toBeNull();
  });
});

describe("clampPlainDate", () => {
  it("pulls a day back into a month that is too short for it", () => {
    // The picker builds a date field by field, so month and day are chosen
    // separately and nothing stops 31 outliving a switch to February.
    expect(plainDateKey(clampPlainDate({ year: 2026, month: 2, day: 31 }))).toBe("2026-02-28");
    expect(plainDateKey(clampPlainDate({ year: 2024, month: 2, day: 31 }))).toBe("2024-02-29");
    expect(plainDateKey(clampPlainDate({ year: 2026, month: 4, day: 31 }))).toBe("2026-04-30");
  });

  it("leaves a real date alone", () => {
    expect(plainDateKey(clampPlainDate({ year: 2026, month: 8, day: 26 }))).toBe("2026-08-26");
  });

  it("produces something parsePlainDate accepts, which is the point", () => {
    // An unclamped Feb 31 reaches the server as "2026-02-31", parsePlainDate
    // rejects it, and partialDate turns the rejection into `undefined` — the
    // form saves and the date is silently gone.
    expect(parsePlainDate("2026-02-31")).toBeNull();
    expect(parsePlainDate(plainDateKey(clampPlainDate({ year: 2026, month: 2, day: 31 })))).not
      .toBeNull();
  });
});

describe("diffPlainDays / addPlainDays", () => {
  it("counts calendar days across a month boundary", () => {
    expect(
      diffPlainDays({ year: 2026, month: 1, day: 28 }, { year: 2026, month: 2, day: 3 }),
    ).toBe(6);
  });

  it("is negative when the target is in the past", () => {
    expect(
      diffPlainDays({ year: 2026, month: 3, day: 10 }, { year: 2026, month: 3, day: 1 }),
    ).toBe(-9);
  });

  it("counts DST transitions as whole days", () => {
    // Spans the US spring-forward; still exactly 7 calendar days.
    expect(
      diffPlainDays({ year: 2026, month: 3, day: 5 }, { year: 2026, month: 3, day: 12 }),
    ).toBe(7);
  });

  it("adds days across a year boundary", () => {
    expect(plainDateKey(addPlainDays({ year: 2026, month: 12, day: 28 }, 5))).toBe("2027-01-02");
  });
});

describe("nextOccurrence", () => {
  const today = { year: 2026, month: 6, day: 15 };

  it("returns the same day when the anniversary is today", () => {
    const next = nextOccurrence({ year: 1990, month: 6, day: 15 }, today, "ANNUAL");
    expect(plainDateKey(next!)).toBe("2026-06-15");
  });

  it("returns this year when the anniversary is still ahead", () => {
    const next = nextOccurrence({ year: 1990, month: 9, day: 2 }, today, "ANNUAL");
    expect(plainDateKey(next!)).toBe("2026-09-02");
  });

  it("rolls to next year when the anniversary has passed", () => {
    const next = nextOccurrence({ year: 1990, month: 2, day: 2 }, today, "ANNUAL");
    expect(plainDateKey(next!)).toBe("2027-02-02");
  });

  it("observes Feb 29 on Feb 28 in a common year", () => {
    const next = nextOccurrence(
      { year: 1992, month: 2, day: 29 },
      { year: 2026, month: 1, day: 1 },
      "ANNUAL",
    );
    expect(plainDateKey(next!)).toBe("2026-02-28");
  });

  it("uses the real Feb 29 in a leap year", () => {
    const next = nextOccurrence(
      { year: 1992, month: 2, day: 29 },
      { year: 2028, month: 1, day: 1 },
      "ANNUAL",
    );
    expect(plainDateKey(next!)).toBe("2028-02-29");
  });

  it("clamps a monthly recurrence to the end of a short month", () => {
    const next = nextOccurrence(
      { year: 2026, month: 1, day: 31 },
      { year: 2026, month: 2, day: 1 },
      "MONTHLY",
    );
    expect(plainDateKey(next!)).toBe("2026-02-28");
  });

  it("returns null for a non-recurring date that has passed", () => {
    expect(nextOccurrence({ year: 2020, month: 1, day: 1 }, today, "NONE")).toBeNull();
  });

  it("returns a future non-recurring date unchanged", () => {
    const next = nextOccurrence({ year: 2026, month: 12, day: 25 }, today, "NONE");
    expect(plainDateKey(next!)).toBe("2026-12-25");
  });
});

describe("yearsBetween", () => {
  it("does not count a birthday that has not happened yet this year", () => {
    expect(yearsBetween({ year: 1990, month: 9, day: 2 }, { year: 2026, month: 6, day: 15 })).toBe(35);
  });

  it("counts the birthday on the day itself", () => {
    expect(yearsBetween({ year: 1990, month: 6, day: 15 }, { year: 2026, month: 6, day: 15 })).toBe(36);
  });
});
