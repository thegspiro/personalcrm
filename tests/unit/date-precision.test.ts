import { describe, expect, it } from "vitest";
import {
  UNKNOWN_YEAR,
  comparePartialDates,
  formatPartialDate,
  formatPartialRange,
  isValidPartialDateRange,
  normalizeToPrecision,
  overlapsRange,
  parsePartialDate,
  precisionRange,
  sortKey,
  yearsSince,
} from "@/lib/date-precision";
import { plainDateKey } from "@/lib/dates";

const MAR_14_2019 = { year: 2019, month: 3, day: 14 };

describe("formatPartialDate", () => {
  it("renders a full date", () => {
    expect(formatPartialDate(MAR_14_2019, "DAY")).toBe("March 14, 2019");
  });

  it("renders a month without inventing a day", () => {
    expect(formatPartialDate({ year: 2019, month: 3, day: 1 }, "MONTH")).toBe("March 2019");
  });

  it("renders a year alone — the whole point of precision", () => {
    expect(formatPartialDate({ year: 2019, month: 1, day: 1 }, "YEAR")).toBe("2019");
  });

  it("renders a birthday with no year", () => {
    expect(formatPartialDate({ year: UNKNOWN_YEAR, month: 3, day: 14 }, "MONTH_DAY")).toBe("March 14");
  });

  it("supports short month names and weekdays", () => {
    expect(formatPartialDate(MAR_14_2019, "DAY", { short: true })).toBe("Mar 14, 2019");
    expect(formatPartialDate(MAR_14_2019, "DAY", { weekday: true })).toBe("Thursday, March 14, 2019");
  });
});

describe("formatPartialRange", () => {
  it("returns a single date when there is no end", () => {
    expect(formatPartialRange({ year: 2015, month: 1, day: 1 }, "YEAR", null, null)).toBe("2015");
  });

  it("renders a multi-year period", () => {
    expect(
      formatPartialRange(
        { year: 2015, month: 1, day: 1 }, "YEAR",
        { year: 2019, month: 1, day: 1 }, "YEAR",
      ),
    ).toBe("2015 – 2019");
  });

  it("collapses a shared year", () => {
    expect(
      formatPartialRange(
        { year: 2019, month: 3, day: 1 }, "MONTH",
        { year: 2019, month: 6, day: 1 }, "MONTH",
      ),
    ).toBe("March – June 2019");
  });

  it("collapses to one value when start and end are identical", () => {
    expect(
      formatPartialRange(
        { year: 2019, month: 1, day: 1 }, "YEAR",
        { year: 2019, month: 1, day: 1 }, "YEAR",
      ),
    ).toBe("2019");
  });
});

describe("normalizeToPrecision", () => {
  it("zeroes the parts a precision does not know", () => {
    expect(plainDateKey(normalizeToPrecision(MAR_14_2019, "MONTH"))).toBe("2019-03-01");
    expect(plainDateKey(normalizeToPrecision(MAR_14_2019, "YEAR"))).toBe("2019-01-01");
    expect(plainDateKey(normalizeToPrecision(MAR_14_2019, "DAY"))).toBe("2019-03-14");
  });

  it("moves an unknown-year date onto the anchor year", () => {
    const out = normalizeToPrecision(MAR_14_2019, "MONTH_DAY");
    expect(out.year).toBe(UNKNOWN_YEAR);
    expect(plainDateKey(out)).toBe(`${UNKNOWN_YEAR}-03-14`);
  });

  it("keeps Feb 29 intact, because the anchor year is a leap year", () => {
    const out = normalizeToPrecision({ year: 1992, month: 2, day: 29 }, "MONTH_DAY");
    expect(plainDateKey(out)).toBe(`${UNKNOWN_YEAR}-02-29`);
  });

  it("is idempotent", () => {
    const once = normalizeToPrecision(MAR_14_2019, "MONTH");
    expect(plainDateKey(normalizeToPrecision(once, "MONTH"))).toBe(plainDateKey(once));
  });

  it("clamps a day-precision date onto a day its month actually has", () => {
    // Day precision is the one case where nothing is padding, so an impossible
    // pair has to resolve here rather than be stored and rejected downstream.
    expect(plainDateKey(normalizeToPrecision({ year: 2026, month: 2, day: 31 }, "DAY"))).toBe(
      "2026-02-28",
    );
  });
});

describe("precisionRange", () => {
  it("spans a whole year for YEAR", () => {
    const { start, end } = precisionRange({ year: 2019, month: 1, day: 1 }, "YEAR");
    expect(plainDateKey(start)).toBe("2019-01-01");
    expect(plainDateKey(end)).toBe("2019-12-31");
  });

  it("spans a whole month for MONTH, including short months", () => {
    const feb = precisionRange({ year: 2019, month: 2, day: 1 }, "MONTH");
    expect(plainDateKey(feb.end)).toBe("2019-02-28");
    const leapFeb = precisionRange({ year: 2020, month: 2, day: 1 }, "MONTH");
    expect(plainDateKey(leapFeb.end)).toBe("2020-02-29");
  });

  it("is a single day for DAY", () => {
    const { start, end } = precisionRange(MAR_14_2019, "DAY");
    expect(plainDateKey(start)).toBe("2019-03-14");
    expect(plainDateKey(end)).toBe("2019-03-14");
  });
});

describe("isValidPartialDateRange", () => {
  const partial = (
    year: number,
    month: number,
    day: number,
    precision: "DAY" | "MONTH" | "YEAR" | "MONTH_DAY",
  ) => ({ date: { year, month, day }, precision });

  it("accepts exact, equal, and open-ended ranges", () => {
    const start = partial(2019, 3, 14, "DAY");
    expect(isValidPartialDateRange(start, partial(2019, 3, 15, "DAY"))).toBe(true);
    expect(isValidPartialDateRange(start, partial(2019, 3, 14, "DAY"))).toBe(true);
    expect(isValidPartialDateRange(start, null)).toBe(true);
  });

  it("accepts chronological month-only and year-only ranges", () => {
    expect(
      isValidPartialDateRange(partial(2019, 3, 1, "MONTH"), partial(2019, 6, 1, "MONTH")),
    ).toBe(true);
    expect(
      isValidPartialDateRange(partial(2019, 1, 1, "YEAR"), partial(2020, 1, 1, "YEAR")),
    ).toBe(true);
  });

  it("allows mixed-precision intervals that have an ambiguous overlap", () => {
    expect(
      isValidPartialDateRange(partial(2019, 1, 1, "YEAR"), partial(2019, 1, 1, "MONTH")),
    ).toBe(true);
    expect(
      isValidPartialDateRange(partial(2019, 3, 1, "MONTH"), partial(2019, 3, 14, "DAY")),
    ).toBe(true);
  });

  it("accepts an unknown-year endpoint because it cannot prove an inversion", () => {
    expect(
      isValidPartialDateRange(
        partial(2020, 1, 1, "YEAR"),
        partial(UNKNOWN_YEAR, 3, 14, "MONTH_DAY"),
      ),
    ).toBe(true);
  });

  it("rejects only definitively inverted exact and fuzzy ranges", () => {
    expect(
      isValidPartialDateRange(partial(2019, 3, 15, "DAY"), partial(2019, 3, 14, "DAY")),
    ).toBe(false);
    expect(
      isValidPartialDateRange(partial(2020, 1, 1, "YEAR"), partial(2019, 12, 1, "MONTH")),
    ).toBe(false);
    expect(
      isValidPartialDateRange(partial(2020, 2, 1, "MONTH"), partial(2020, 1, 1, "YEAR")),
    ).toBe(true);
  });
});

describe("sorting mixed precisions", () => {
  it("sorts a fuzzy year alongside early that year, not at its end", () => {
    expect(sortKey({ year: 2019, month: 1, day: 1 }, "YEAR")).toBe("2019-01-01");
  });

  it("orders newest first", () => {
    const items = [
      { date: { year: 2019, month: 1, day: 1 }, precision: "YEAR" as const },
      { date: { year: 2020, month: 6, day: 15 }, precision: "DAY" as const },
      { date: { year: 2019, month: 6, day: 1 }, precision: "MONTH" as const },
    ];
    const sorted = [...items].sort(comparePartialDates);
    expect(sorted.map((i) => formatPartialDate(i.date, i.precision))).toEqual([
      "June 15, 2020",
      "June 2019",
      "2019",
    ]);
  });

  it("puts the more precise value first when two start on the same day", () => {
    const vague = { date: { year: 2019, month: 1, day: 1 }, precision: "YEAR" as const };
    const exact = { date: { year: 2019, month: 1, day: 1 }, precision: "DAY" as const };
    expect(comparePartialDates(exact, vague)).toBeLessThan(0);
  });
});

describe("overlapsRange", () => {
  const from = { year: 2019, month: 3, day: 1 };
  const to = { year: 2019, month: 3, day: 31 };

  it("matches a fuzzy year against a month inside it", () => {
    expect(overlapsRange({ year: 2019, month: 1, day: 1 }, "YEAR", from, to)).toBe(true);
  });

  it("excludes a year that does not reach the range", () => {
    expect(overlapsRange({ year: 2018, month: 1, day: 1 }, "YEAR", from, to)).toBe(false);
  });

  it("matches an exact date inside the range and excludes one outside", () => {
    expect(overlapsRange(MAR_14_2019, "DAY", from, to)).toBe(true);
    expect(overlapsRange({ year: 2019, month: 4, day: 2 }, "DAY", from, to)).toBe(false);
  });

  it("treats a missing bound as open-ended", () => {
    expect(overlapsRange({ year: 1999, month: 5, day: 5 }, "DAY", null, to)).toBe(true);
    expect(overlapsRange({ year: 2099, month: 5, day: 5 }, "DAY", from, null)).toBe(true);
  });
});

describe("parsePartialDate", () => {
  const cases: Array<[string, string, string]> = [
    ["2019", "YEAR", "2019-01-01"],
    ["2019-03", "MONTH", "2019-03-01"],
    ["2019/03", "MONTH", "2019-03-01"],
    ["2019-03-14", "DAY", "2019-03-14"],
    ["2019/3/14", "DAY", "2019-03-14"],
    ["March 2019", "MONTH", "2019-03-01"],
    ["mar 2019", "MONTH", "2019-03-01"],
    ["March 14, 2019", "DAY", "2019-03-14"],
    ["March 14", "MONTH_DAY", `${UNKNOWN_YEAR}-03-14`],
    ["3/14", "MONTH_DAY", `${UNKNOWN_YEAR}-03-14`],
  ];

  for (const [input, precision, key] of cases) {
    it(`parses "${input}" at ${precision} precision`, () => {
      const parsed = parsePartialDate(input);
      expect(parsed).not.toBeNull();
      expect(parsed!.precision).toBe(precision);
      expect(plainDateKey(parsed!.date)).toBe(key);
    });
  }

  it("rejects impossible and unparseable input rather than guessing", () => {
    for (const input of ["", "   ", "someday", "2019-13", "2019-02-30", "1500", "13/40"]) {
      expect(parsePartialDate(input), input).toBeNull();
    }
  });
});

describe("yearsSince", () => {
  const today = { year: 2026, month: 6, day: 15 };

  it("does not count a birthday still ahead this year", () => {
    expect(yearsSince({ year: 1990, month: 9, day: 2 }, "DAY", today)).toBe(35);
  });

  it("counts it on the day", () => {
    expect(yearsSince({ year: 1990, month: 6, day: 15 }, "DAY", today)).toBe(36);
  });

  it("returns null when the year is unknown rather than pretending it is zero", () => {
    expect(yearsSince({ year: UNKNOWN_YEAR, month: 3, day: 14 }, "MONTH_DAY", today)).toBeNull();
  });

  it("uses whole years for a year-precision date", () => {
    expect(yearsSince({ year: 2019, month: 1, day: 1 }, "YEAR", today)).toBe(7);
  });
});
