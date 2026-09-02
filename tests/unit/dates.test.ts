import { describe, expect, it } from "vitest";
import {
  addPlainDays,
  calendarDateInTz,
  clampPlainDate,
  diffPlainDays,
  endOfDayInTz,
  nextOccurrence,
  parsePlainDate,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  projectDateOccurrences,
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

  it("starts the day at the transition where the clocks jump over midnight", () => {
    // Santiago moves to DST at 24:00 on 2026-09-05, so 00:00 on the 6th never
    // happens and the day begins at 01:00. Answering 23:00 on the 5th — which
    // the arithmetic guess does — loses the last hour of the 5th from every
    // query bounded by a day boundary.
    const start = zonedStartOfDay({ year: 2026, month: 9, day: 6 }, "America/Santiago");
    expect(start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("starts the day at the transition when the jump is at midnight itself", () => {
    // Beirut goes straight from 00:00 to 01:00 on 2026-03-29.
    const start = zonedStartOfDay({ year: 2026, month: 3, day: 29 }, "Asia/Beirut");
    expect(start.toISOString()).toBe("2026-03-28T22:00:00.000Z");
  });

  it("returns the first of a midnight the clocks roll back through", () => {
    // Amman rolled back an hour at midnight on 2000-09-29, so 00:00 happened
    // twice. Answering the second puts the repeated hour on the wrong day, and
    // a contact due in it is read as due a day early.
    const start = zonedStartOfDay({ year: 2000, month: 9, day: 29 }, "Asia/Amman");
    expect(start.toISOString()).toBe("2000-09-28T21:00:00.000Z");
  });

  it("returns the first of a midnight repeated by a multi-hour rollback", () => {
    // Casey went from +11 to +08 across midnight on 2019-03-17: three hours,
    // so both naive guesses land on the later 00:00.
    const start = zonedStartOfDay({ year: 2019, month: 3, day: 17 }, "Antarctica/Casey");
    expect(start.toISOString()).toBe("2019-03-16T13:00:00.000Z");
  });

  it("handles a day the zone skipped entirely", () => {
    // Apia crossed the date line at the end of 2011: 30 December never
    // happened, so the 31st begins where the 29th ended.
    const start = zonedStartOfDay({ year: 2011, month: 12, day: 31 }, "Pacific/Apia");
    expect(start.toISOString()).toBe("2011-12-30T10:00:00.000Z");
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

describe("projectDateOccurrences", () => {
  const today = { year: 2026, month: 6, day: 15 };

  it("projects annual dates without losing their known anchor year", () => {
    const anchor = { year: 1990, month: 7, day: 4 };
    const occurrences = projectDateOccurrences(anchor, "DAY", "ANNUAL", today, {
      from: today,
      to: { year: 2027, month: 7, day: 4 },
    });
    expect(occurrences.map(plainDateKey)).toEqual(["2026-07-04", "2027-07-04"]);
    expect(anchor.year).toBe(1990);
  });

  it("projects monthly dates across the year boundary", () => {
    const occurrences = projectDateOccurrences(
      { year: 2020, month: 1, day: 10 },
      "DAY",
      "MONTHLY",
      { year: 2026, month: 11, day: 20 },
      {
        from: { year: 2026, month: 12, day: 1 },
        to: { year: 2027, month: 2, day: 10 },
      },
    );
    expect(occurrences.map(plainDateKey)).toEqual([
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
    ]);
  });

  it("projects both known- and unknown-year day precision", () => {
    const window = { from: today, to: { year: 2026, month: 8, day: 1 } };
    expect(
      projectDateOccurrences({ year: 1985, month: 7, day: 2 }, "DAY", "ANNUAL", today, window)
        .map(plainDateKey),
    ).toEqual(["2026-07-02"]);
    expect(
      projectDateOccurrences(
        { year: 1904, month: 7, day: 2 },
        "MONTH_DAY",
        "ANNUAL",
        today,
        window,
      ).map(plainDateKey),
    ).toEqual(["2026-07-02"]);
    expect(
      projectDateOccurrences({ year: 2020, month: 7, day: 1 }, "MONTH", "ANNUAL", today, window),
    ).toEqual([]);
  });

  it("applies the shared Feb 29 policy throughout a range", () => {
    const occurrences = projectDateOccurrences(
      { year: 1992, month: 2, day: 29 },
      "DAY",
      "ANNUAL",
      { year: 2027, month: 1, day: 1 },
      {
        from: { year: 2027, month: 1, day: 1 },
        to: { year: 2028, month: 3, day: 1 },
      },
    );
    expect(occurrences.map(plainDateKey)).toEqual(["2027-02-28", "2028-02-29"]);
  });

  it("filters occurrences to inclusive range bounds and classifies one-time dates", () => {
    const window = {
      from: { year: 2026, month: 7, day: 1 },
      to: { year: 2026, month: 7, day: 31 },
    };
    expect(
      projectDateOccurrences({ year: 1990, month: 6, day: 30 }, "DAY", "MONTHLY", today, window)
        .map(plainDateKey),
    ).toEqual(["2026-07-30"]);
    expect(
      projectDateOccurrences({ year: 2020, month: 1, day: 1 }, "DAY", "NONE", today, window),
    ).toEqual([]);
    expect(
      projectDateOccurrences({ year: 2026, month: 7, day: 31 }, "DAY", "NONE", today, window)
        .map(plainDateKey),
    ).toEqual(["2026-07-31"]);
  });

  it("keeps future partial one-time dates upcoming without inventing a display day", () => {
    expect(
      projectDateOccurrences(
        { year: 2026, month: 8, day: 1 },
        "MONTH",
        "NONE",
        today,
        { from: today, to: { year: 2026, month: 8, day: 31 } },
      ).map(plainDateKey),
    ).toEqual(["2026-08-01"]);

    // The year is already in progress, so today is the earliest honest sort
    // key even though callers still render the stored value as just "2026".
    expect(
      projectDateOccurrences(
        { year: 2026, month: 1, day: 1 },
        "YEAR",
        "NONE",
        today,
        { from: today, to: { year: 2026, month: 12, day: 31 } },
      ).map(plainDateKey),
    ).toEqual(["2026-06-15"]);
  });

  it("uses the user's calendar day at a timezone boundary", () => {
    const instant = new Date("2026-07-04T02:00:00Z");
    const newYorkToday = calendarDateInTz(instant, NY);
    const tokyoToday = calendarDateInTz(instant, TOKYO);
    const anchor = { year: 1990, month: 7, day: 3 };
    const horizon = { year: 2026, month: 7, day: 4 };

    expect(
      projectDateOccurrences(anchor, "DAY", "ANNUAL", newYorkToday, {
        from: newYorkToday,
        to: horizon,
      }).map(plainDateKey),
    ).toEqual(["2026-07-03"]);
    expect(
      projectDateOccurrences(anchor, "DAY", "ANNUAL", tokyoToday, {
        from: tokyoToday,
        to: horizon,
      }),
    ).toEqual([]);
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

describe("endOfDayInTz", () => {
  it("keeps the final second of a day the clocks jump out of", () => {
    const end = endOfDayInTz(new Date("2026-09-05T20:00:00Z"), "America/Santiago");
    // 23:59:59.999 local on the 5th, one millisecond before the 6th begins.
    expect(end.toISOString()).toBe("2026-09-06T03:59:59.999Z");
  });

  it("covers a whole ordinary day", () => {
    const end = endOfDayInTz(new Date("2026-07-15T18:45:00Z"), NY);
    expect(end.toISOString()).toBe("2026-07-16T03:59:59.999Z");
  });
});
