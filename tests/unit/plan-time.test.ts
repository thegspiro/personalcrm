import { describe, expect, it } from "vitest";
import {
  PLAN_DURATION_MAX,
  PLAN_MINUTE_MAX,
  formatPlanDuration,
  formatPlanTime,
  parsePlanDuration,
  parsePlanMinute,
  planInstant,
  planMinuteToInput,
} from "@/lib/plan-time";

const NY = "America/New_York";

describe("parsePlanMinute", () => {
  it("reads a time input into minutes past midnight", () => {
    expect(parsePlanMinute("19:30")).toEqual({ ok: true, value: 19 * 60 + 30 });
    expect(parsePlanMinute("09:05")).toEqual({ ok: true, value: 545 });
    expect(parsePlanMinute("9:05")).toEqual({ ok: true, value: 545 });
  });

  it("holds both ends of the day", () => {
    expect(parsePlanMinute("00:00")).toEqual({ ok: true, value: 0 });
    expect(parsePlanMinute("23:59")).toEqual({ ok: true, value: PLAN_MINUTE_MAX });
  });

  it("treats absent and empty as no time rather than an error", () => {
    expect(parsePlanMinute(undefined)).toEqual({ ok: true, value: null });
    expect(parsePlanMinute(null)).toEqual({ ok: true, value: null });
    expect(parsePlanMinute("")).toEqual({ ok: true, value: null });
    expect(parsePlanMinute("   ")).toEqual({ ok: true, value: null });
  });

  it("rejects rather than coerces anything else", () => {
    // A server action is a public POST endpoint: reading these as midnight
    // would file a plan at a time nobody chose.
    for (const raw of ["24:00", "23:60", "7pm", "19:3", "19:300", "-1:00", "1930", "19:30:00"]) {
      expect(parsePlanMinute(raw), raw).toEqual({ ok: false });
    }
  });
});

describe("parsePlanDuration", () => {
  it("reads whole minutes", () => {
    expect(parsePlanDuration("90")).toEqual({ ok: true, value: 90 });
    expect(parsePlanDuration(String(PLAN_DURATION_MAX))).toEqual({
      ok: true,
      value: PLAN_DURATION_MAX,
    });
  });

  it("treats absent, empty and zero as no duration", () => {
    expect(parsePlanDuration(undefined)).toEqual({ ok: true, value: null });
    expect(parsePlanDuration("")).toEqual({ ok: true, value: null });
    expect(parsePlanDuration("0")).toEqual({ ok: true, value: null });
  });

  it("rejects a negative, a fraction, and longer than a day", () => {
    for (const raw of ["-30", "1.5", "abc", String(PLAN_DURATION_MAX + 1)]) {
      expect(parsePlanDuration(raw), raw).toEqual({ ok: false });
    }
  });
});

describe("planMinuteToInput", () => {
  it("round-trips through parsePlanMinute", () => {
    for (const minute of [0, 5, 545, 1170, PLAN_MINUTE_MAX]) {
      expect(parsePlanMinute(planMinuteToInput(minute))).toEqual({ ok: true, value: minute });
    }
  });

  it("gives an empty string for no time, so the input renders blank", () => {
    expect(planMinuteToInput(null)).toBe("");
    expect(planMinuteToInput(undefined)).toBe("");
  });
});

describe("formatPlanTime", () => {
  it("reads as a wall-clock time", () => {
    expect(formatPlanTime(19 * 60 + 30)).toBe("7:30 PM");
    expect(formatPlanTime(0)).toBe("12:00 AM");
    expect(formatPlanTime(PLAN_MINUTE_MAX)).toBe("11:59 PM");
  });

  it("shows nothing when no time was set", () => {
    expect(formatPlanTime(null)).toBeNull();
    expect(formatPlanTime(undefined)).toBeNull();
  });
});

describe("formatPlanDuration", () => {
  it("reads in hours and minutes", () => {
    expect(formatPlanDuration(30)).toBe("30m");
    expect(formatPlanDuration(60)).toBe("1h");
    expect(formatPlanDuration(90)).toBe("1h 30m");
    expect(formatPlanDuration(240)).toBe("4h");
  });

  it("shows nothing for no duration", () => {
    expect(formatPlanDuration(null)).toBeNull();
    expect(formatPlanDuration(undefined)).toBeNull();
    expect(formatPlanDuration(0)).toBeNull();
  });
});

describe("planInstant", () => {
  it("resolves the day and minute in the account's timezone", () => {
    const at = planInstant({ year: 2026, month: 1, day: 15 }, 19 * 60 + 30, NY);
    expect(at.toISOString()).toBe("2026-01-16T00:30:00.000Z");
  });

  it("falls back to the start of the day when no time was set", () => {
    // So a day's agenda can order everything without branching: "sometime on
    // the 15th" sits before anything actually timed on the 15th.
    const at = planInstant({ year: 2026, month: 1, day: 15 }, null, NY);
    expect(at.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });
});
