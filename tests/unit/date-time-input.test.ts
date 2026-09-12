import { describe, expect, it } from "vitest";
import {
  formatLocalDateTime,
  localDateTimeFromDate,
  localTimeValue,
  parseLocalDateTime,
  shiftLocalDays,
  withLocalDate,
  withLocalTime,
} from "@/lib/date-time-input";

/**
 * The wall clock a `datetime-local` carries, taken apart and put back.
 *
 * The reason this is arithmetic on plain dates rather than on `Date` is in the
 * DST cases at the bottom: a shift that goes through a real instant lands an
 * hour out twice a year, and "when did this happen" is exactly the field
 * nobody re-reads afterwards.
 */
const NOON = { date: { year: 2026, month: 9, day: 11 }, hour: 12, minute: 0 };

describe("reading an input value", () => {
  it("round-trips a value through parse and format", () => {
    const parsed = parseLocalDateTime("2026-09-11T18:00");
    expect(parsed).toEqual({ date: { year: 2026, month: 9, day: 11 }, hour: 18, minute: 0 });
    expect(formatLocalDateTime(parsed!)).toBe("2026-09-11T18:00");
  });

  it("accepts the seconds a browser adds and drops them", () => {
    expect(parseLocalDateTime("2026-09-11T18:00:30")).toEqual({
      date: { year: 2026, month: 9, day: 11 },
      hour: 18,
      minute: 0,
    });
  });

  it("answers null for empty, half-typed and impossible values", () => {
    // A field being cleared passes through every one of these, and treating a
    // prefix as a date is how a picker commits a year nobody meant to type.
    for (const raw of ["", "   ", "2026-09-11", "2026-09-11T", "2026-09-11T1", "not a date"]) {
      expect(parseLocalDateTime(raw)).toBeNull();
    }
    // The day does not exist, so neither does the reading.
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeNull();
    expect(parseLocalDateTime("2026-09-11T24:00")).toBeNull();
    expect(parseLocalDateTime("2026-09-11T10:60")).toBeNull();
  });

  it("pads every part on the way out", () => {
    expect(formatLocalDateTime({ date: { year: 2026, month: 1, day: 5 }, hour: 9, minute: 5 })).toBe(
      "2026-01-05T09:05",
    );
    expect(localTimeValue({ date: { year: 2026, month: 1, day: 5 }, hour: 9, minute: 5 })).toBe(
      "09:05",
    );
  });

  it("clamps a day its month does not have rather than emitting a blank field", () => {
    // An input shows nothing at all for 2026-02-31, which reads as the date
    // having been lost. The 28th is a visible answer.
    expect(
      formatLocalDateTime({ date: { year: 2026, month: 2, day: 31 }, hour: 8, minute: 0 }),
    ).toBe("2026-02-28T08:00");
  });

  it("answers null for an instant that is not one", () => {
    expect(localDateTimeFromDate(new Date("nonsense"))).toBeNull();
  });
});

describe("moving a day without moving the clock", () => {
  it("keeps the time of day", () => {
    expect(shiftLocalDays(NOON, -1)).toEqual({ ...NOON, date: { year: 2026, month: 9, day: 10 } });
    expect(shiftLocalDays(NOON, -7)).toEqual({ ...NOON, date: { year: 2026, month: 9, day: 4 } });
    expect(shiftLocalDays(NOON, -30)).toEqual({ ...NOON, date: { year: 2026, month: 8, day: 12 } });
  });

  it("crosses a year end", () => {
    const newYear = { date: { year: 2027, month: 1, day: 1 }, hour: 0, minute: 30 };
    expect(shiftLocalDays(newYear, -1).date).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("keeps the wall clock across a spring-forward, whatever zone the browser is in", () => {
    // 2026-03-08 is the US spring-forward. Measured as elapsed time, "one day
    // earlier" from Sunday 01:30 lands at 00:30 or 02:30 depending on the zone
    // and the direction. As calendar arithmetic there is one answer.
    const afterTransition = { date: { year: 2026, month: 3, day: 8 }, hour: 1, minute: 30 };
    const back = shiftLocalDays(afterTransition, -1);
    expect(back).toEqual({ date: { year: 2026, month: 3, day: 7 }, hour: 1, minute: 30 });
    expect(formatLocalDateTime(back)).toBe("2026-03-07T01:30");
  });
});

describe("replacing one half of the value", () => {
  it("puts a new day on the time already chosen", () => {
    expect(withLocalDate(NOON, { year: 1999, month: 12, day: 31 })).toEqual({
      date: { year: 1999, month: 12, day: 31 },
      hour: 12,
      minute: 0,
    });
  });

  it("puts a new time on the day already chosen", () => {
    expect(withLocalTime(NOON, "18:45")).toEqual({ ...NOON, hour: 18, minute: 45 });
    expect(withLocalTime(NOON, "18:45:00")).toEqual({ ...NOON, hour: 18, minute: 45 });
  });

  it("refuses a time it cannot read, so a field being cleared commits nothing", () => {
    for (const raw of ["", "18", "18:", "1845", "25:00", "18:61"]) {
      expect(withLocalTime(NOON, raw)).toBeNull();
    }
  });
});
