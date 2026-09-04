import { describe, expect, it } from "vitest";
import { dueOccurrence, effectiveReminderDays, parseReminderDays } from "@/lib/reminders";
import { dailyOccurrence, digestIsDue, digestMessage, importantDateMessage, localClock, reminderDedupKey } from "@/lib/reminder-schedule";

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

describe("daily reminder scheduling", () => {
  it("uses the account timezone at a UTC date boundary", () => {
    const now = new Date("2026-09-02T01:30:00Z");
    expect(dailyOccurrence(now, "America/Los_Angeles")).toBe("2026-09-01");
    expect(dailyOccurrence(now, "Asia/Tokyo")).toBe("2026-09-02");
  });

  it("honors the local digest hour and catches a skipped DST hour", () => {
    expect(digestIsDue(new Date("2026-03-08T06:59:00Z"), "America/New_York", 2)).toBe(false);
    // 02:00 does not exist on this spring-forward day; the 03:00 pass is due.
    expect(localClock(new Date("2026-03-08T07:00:00Z"), "America/New_York")).toMatchObject({ hour: 3 });
    expect(digestIsDue(new Date("2026-03-08T07:00:00Z"), "America/New_York", 2)).toBe(true);
  });

  it("maps both repeated fall-back hours to one durable daily occurrence", () => {
    const first = new Date("2026-11-01T05:30:00Z");
    const second = new Date("2026-11-01T06:30:00Z");
    expect(localClock(first, "America/New_York").hour).toBe(1);
    expect(localClock(second, "America/New_York").hour).toBe(1);
    expect(dailyOccurrence(first, "America/New_York")).toBe(dailyOccurrence(second, "America/New_York"));
  });

  it("deduplicates identical deliveries but separates policy, occurrence, and channel", () => {
    const base = { ownerId: "owner", entityType: "TASK", entityId: "task", policy: "INCOMPLETE_TASK_DUE" as const,
      occurrence: "2026-09-02", offsetDays: 0, channelId: "email" };
    expect(reminderDedupKey(base)).toBe(reminderDedupKey({ ...base }));
    expect(reminderDedupKey(base)).not.toBe(reminderDedupKey({ ...base, channelId: "ntfy" }));
    expect(reminderDedupKey(base)).not.toBe(reminderDedupKey({ ...base, occurrence: "2026-09-03" }));
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

describe("reminder wording", () => {
  const today = { year: 2026, month: 9, day: 2 };

  it("is written from the day it goes out, so a late retry does not promise a date already past", () => {
    const say = (day: number) => importantDateMessage("Birthday", "Sam Jones", { year: 2026, month: 9, day }, today).body;
    expect(say(2)).toBe("Birthday for Sam Jones is today (2026-09-02).");
    expect(say(3)).toBe("Birthday for Sam Jones is tomorrow (2026-09-03).");
    expect(say(9)).toBe("Birthday for Sam Jones is in 7 days (2026-09-09).");
    expect(say(1)).toBe("Birthday for Sam Jones was yesterday (2026-09-01).");
    expect(importantDateMessage("Birthday", "Sam Jones", { year: 2026, month: 8, day: 30 }, today).body)
      .toBe("Birthday for Sam Jones was 3 days ago (2026-08-30).");
  });

  it("formats digest sections in deterministic date and text order", () => {
    expect(digestMessage([
      { kind: "TASK", title: "Write card", contactName: "Zoe", date: { year: 2026, month: 9, day: 3 } },
      { kind: "CADENCE", contactName: "Alex", date: { year: 2026, month: 9, day: 1 } },
      { kind: "IMPORTANT_DATE", label: "Birthday", contactName: "Sam", date: { year: 2026, month: 9, day: 9 } },
      { kind: "TASK", title: "Book table", contactName: null, date: today },
    ], today).body).toBe([
      "Important dates",
      "- Birthday — Sam (upcoming: 2026-09-09)",
      "",
      "Keep in touch",
      "- Alex (overdue: 2026-09-01)",
      "",
      "Tasks",
      "- Book table (due today: 2026-09-02)",
      "- Write card — Zoe (upcoming: 2026-09-03)",
    ].join("\n"));
  });

  it("spends the last entries on what is due, not on what is merely coming", () => {
    // The look-ahead can hand the formatter twenty important dates whose
    // reminders land in the next two days. Grouped by kind alone they would all
    // sort ahead of an overdue person, who would then be reported only as part
    // of a count — losing the one thing the digest exists to surface.
    const previews = Array.from({ length: 3 }, (_, index) => ({
      kind: "IMPORTANT_DATE" as const,
      label: `Birthday ${index + 1}`,
      contactName: `Future ${index + 1}`,
      date: { year: 2026, month: 10, day: index + 1 },
      preview: true,
    }));
    const body = digestMessage([
      ...previews,
      { kind: "CADENCE", contactName: "Overdue Person", date: { year: 2026, month: 8, day: 28 } },
    ], today, 2).body;

    expect(body).toContain("Overdue Person (overdue: 2026-08-28)");
    expect(body).toContain("… and 2 more items.");
    // Sections still render in group order, whichever entries survived.
    expect(body.indexOf("Important dates")).toBeLessThan(body.indexOf("Keep in touch"));
  });

  it("keeps a reminder owed today whose occurrence is still weeks away", () => {
    // A birthday warned about a week ahead is owed *today*; its occurrence date
    // says "upcoming" about work that is due now. Rank on the date instead of
    // on the reminder day and enough overdue items push it out of a digest it
    // has every right to be in.
    const overdue = Array.from({ length: 3 }, (_, index) => ({
      kind: "CADENCE" as const,
      contactName: `Overdue ${index + 1}`,
      date: { year: 2026, month: 8, day: 20 + index },
    }));
    const body = digestMessage([
      { kind: "IMPORTANT_DATE", label: "Birthday", contactName: "Sam", date: { year: 2026, month: 9, day: 9 } },
      ...overdue,
    ], today, 3).body;

    expect(body).toContain("Birthday — Sam (upcoming: 2026-09-09)");
    expect(body).toContain("… and 1 more item.");
  });

  it("keeps a useful empty state without empty headings", () => {
    expect(digestMessage([], today).body).toBe("Nothing needs your attention today.");
  });

  it("bounds entries at item boundaries and reveals only the remaining count", () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      kind: "TASK" as const,
      title: `Task ${index + 1}`,
      contactName: `Person ${index + 1}`,
      date: today,
    }));
    expect(digestMessage(items, today, 2).body).toBe([
      "Tasks",
      "- Task 1 — Person 1 (due today: 2026-09-02)",
      "- Task 2 — Person 2 (due today: 2026-09-02)",
      "",
      "… and 2 more items.",
    ].join("\n"));
    expect(digestMessage(items, today, 2).body).not.toContain("Person 3");
  });
});
