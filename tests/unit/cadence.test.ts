import { describe, expect, it } from "vitest";
import {
  cadenceLabel,
  cadenceStatus,
  computeNextTouchAt,
  daysSinceLastInteraction,
  daysUntilTouch,
  snoozeUntil,
} from "@/lib/cadence";
import { endOfDayInTz } from "@/lib/dates";

const NY = "America/New_York";
const CREATED = new Date("2026-01-01T12:00:00Z");

describe("computeNextTouchAt", () => {
  it("returns null when no cadence is set", () => {
    expect(
      computeNextTouchAt({
        cadenceDays: null,
        lastInteractionAt: new Date("2026-06-01T12:00:00Z"),
        snoozedUntil: null,
        createdAt: CREATED,
      }),
    ).toBeNull();
  });

  it("treats a zero or negative cadence as no cadence", () => {
    for (const cadenceDays of [0, -5]) {
      expect(
        computeNextTouchAt({ cadenceDays, lastInteractionAt: null, snoozedUntil: null, createdAt: CREATED }),
      ).toBeNull();
    }
  });

  it("counts forward from the last interaction", () => {
    const next = computeNextTouchAt({
      cadenceDays: 30,
      lastInteractionAt: new Date("2026-06-01T12:00:00Z"),
      snoozedUntil: null,
      createdAt: CREATED,
    });
    expect(next!.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("falls back to the creation date when nothing has been logged", () => {
    const next = computeNextTouchAt({
      cadenceDays: 10,
      lastInteractionAt: null,
      snoozedUntil: null,
      createdAt: CREATED,
    });
    expect(next!.toISOString()).toBe("2026-01-11T12:00:00.000Z");
  });

  it("counts from the snooze when the snooze is later than the last interaction", () => {
    const next = computeNextTouchAt({
      cadenceDays: 30,
      lastInteractionAt: new Date("2026-06-01T12:00:00Z"),
      snoozedUntil: new Date("2026-06-20T12:00:00Z"),
      createdAt: CREATED,
    });
    expect(next!.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("ignores a snooze that has already been overtaken by an interaction", () => {
    const next = computeNextTouchAt({
      cadenceDays: 30,
      lastInteractionAt: new Date("2026-06-25T12:00:00Z"),
      snoozedUntil: new Date("2026-06-20T12:00:00Z"),
      createdAt: CREATED,
    });
    expect(next!.toISOString()).toBe("2026-07-25T12:00:00.000Z");
  });
});

describe("cadenceStatus", () => {
  const now = new Date("2026-06-15T16:00:00Z"); // noon in New York

  it("reports none without a cadence", () => {
    expect(cadenceStatus(null, NY, now)).toBe("none");
  });

  it("reports overdue when the due date has passed", () => {
    expect(cadenceStatus(new Date("2026-06-10T16:00:00Z"), NY, now)).toBe("overdue");
  });

  it("reports overdue on the day it comes due, even later that evening", () => {
    const laterToday = new Date("2026-06-16T02:00:00Z");
    expect(cadenceStatus(laterToday, NY, now)).toBe("overdue");
    expect(laterToday.getTime()).toBeLessThanOrEqual(endOfDayInTz(now, NY).getTime());
  });

  it("reports due-soon inside the window", () => {
    expect(cadenceStatus(new Date("2026-06-18T16:00:00Z"), NY, now)).toBe("due-soon");
  });

  it("reports ok outside the window", () => {
    expect(cadenceStatus(new Date("2026-06-30T16:00:00Z"), NY, now)).toBe("ok");
  });

  it("is evaluated in the user's timezone, not UTC", () => {
    // 2026-06-16T02:00Z is 'tomorrow' in UTC but still today in New York,
    // so a New York user sees this as due now.
    const nextTouch = new Date("2026-06-16T02:00:00Z");
    expect(daysUntilTouch(nextTouch, NY, now)).toBe(0);
    expect(daysUntilTouch(nextTouch, "UTC", now)).toBe(1);
  });
});

describe("daysSinceLastInteraction", () => {
  const now = new Date("2026-06-15T16:00:00Z");

  it("returns null when nothing has been logged", () => {
    expect(daysSinceLastInteraction(null, NY, now)).toBeNull();
  });

  it("counts calendar days", () => {
    expect(daysSinceLastInteraction(new Date("2026-06-05T16:00:00Z"), NY, now)).toBe(10);
  });

  it("returns 0 for something logged earlier today", () => {
    expect(daysSinceLastInteraction(new Date("2026-06-15T13:00:00Z"), NY, now)).toBe(0);
  });
});

describe("snoozeUntil", () => {
  it("lands on local midnight the requested number of days out", () => {
    const now = new Date("2026-06-15T16:00:00Z");
    expect(snoozeUntil(7, NY, now).toISOString()).toBe("2026-06-22T04:00:00.000Z");
  });

  it("crosses a DST boundary without losing a day", () => {
    // 2026-10-28 -> +7 days lands after the Nov 1 fall-back.
    const now = new Date("2026-10-28T16:00:00Z");
    expect(snoozeUntil(7, NY, now).toISOString()).toBe("2026-11-04T05:00:00.000Z");
  });
});

describe("cadenceLabel", () => {
  it("names known presets", () => {
    expect(cadenceLabel(90)).toBe("Quarterly");
    expect(cadenceLabel(null)).toBe("No cadence");
  });

  it("falls back to a day count for custom cadences", () => {
    expect(cadenceLabel(45)).toBe("Every 45 days");
  });
});
