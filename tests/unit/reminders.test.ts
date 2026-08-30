import { describe, expect, it } from "vitest";
import { dueOccurrence, effectiveReminderDays, parseReminderDays } from "@/lib/reminders";

describe("reminder policies", () => {
  it("keeps account default, custom, and disabled distinct", () => {
    expect(parseReminderDays("default", undefined)).toBeNull();
    expect(parseReminderDays("custom", "0, 30, 7, 7")).toEqual([30, 7, 0]);
    expect(parseReminderDays("disabled", "7, 0")).toEqual([]);
    expect(parseReminderDays("on-day", undefined)).toEqual([0]);
    expect(parseReminderDays("week", undefined)).toEqual([7]);
    expect(parseReminderDays("month", undefined)).toEqual([30]);
    expect(effectiveReminderDays(null)).toEqual([7, 0]);
    expect(effectiveReminderDays([])).toEqual([]);
  });

  it("rejects an empty or malformed custom policy instead of treating it as default", () => {
    expect(() => parseReminderDays("custom", "")).toThrow();
    expect(() => parseReminderDays("custom", "tomorrow")).toThrow();
    expect(() => parseReminderDays(undefined, undefined)).toThrow();
  });
});

describe("dueOccurrence", () => {
  const today = { year: 2026, month: 8, day: 29 };

  it("finds annual and monthly reminder offsets", () => {
    expect(dueOccurrence({ year: 1990, month: 9, day: 5 }, "ANNUAL", today, 7)).toEqual({ year: 2026, month: 9, day: 5 });
    expect(dueOccurrence({ year: 2025, month: 1, day: 29 }, "MONTHLY", today, 0)).toEqual(today);
  });

  it("observes February 29 on February 28 in common years", () => {
    expect(dueOccurrence({ year: 2024, month: 2, day: 29 }, "ANNUAL", { year: 2027, month: 2, day: 28 }, 0))
      .toEqual({ year: 2027, month: 2, day: 28 });
  });

  it("does not match an unrelated day", () => {
    expect(dueOccurrence({ year: 2020, month: 12, day: 1 }, "ANNUAL", today, 7)).toBeNull();
  });
});
