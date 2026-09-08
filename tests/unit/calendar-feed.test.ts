import { describe, expect, it } from "vitest";
import { entryRowKey, toFeedEvents, type FeedEntry } from "@/lib/calendar-feed";
import { icsDocument } from "@/lib/export/ics";
import type { PlainDate } from "@/lib/dates";

const STAMP = new Date("2026-09-06T12:00:00.000Z");
const TZ = "America/New_York";

function day(year: number, month: number, date: number): PlainDate {
  return { year, month, day: date };
}

function entry(over: Partial<FeedEntry> & Pick<FeedEntry, "id" | "kind" | "day">): FeedEntry {
  return {
    title: "Something",
    contact: null,
    minute: null,
    durationMinutes: null,
    note: null,
    ...over,
  };
}

describe("what a subscription carries", () => {
  it("leaves interactions out — a subscription is for what is coming", () => {
    const events = toFeedEvents(
      [
        entry({ id: "interaction:1", kind: "interaction", day: day(2026, 9, 1), title: "Coffee" }),
        entry({ id: "task:1", kind: "task", day: day(2026, 9, 2), title: "Call back" }),
      ],
      TZ,
    );
    expect(events.map((event) => event.summary)).toEqual(["Call back"]);
  });

  it("names the person, because a bare label is useless in a shared calendar", () => {
    const [event] = toFeedEvents(
      [
        entry({
          id: "date:1@2026-11-02",
          kind: "date",
          day: day(2026, 11, 2),
          title: "Birthday",
          contact: { firstName: "Alex", lastName: "Kim" },
        }),
      ],
      TZ,
    );
    expect(event.summary).toBe("Birthday — Alex Kim");
  });

  it("does not repeat a name the title already carries", () => {
    const [event] = toFeedEvents(
      [
        entry({
          id: "happening:1@2026-09-10",
          kind: "happening",
          day: day(2026, 9, 10),
          title: "Alex Kim is away",
          contact: { firstName: "Alex", lastName: "Kim" },
        }),
      ],
      TZ,
    );
    expect(event.summary).toBe("Alex Kim is away");
  });
});

describe("spans", () => {
  it("folds a happening's per-day entries back into one event", () => {
    // The grid draws a chip per square; a calendar client understands a span,
    // so ten days away is one event rather than ten.
    const days = [10, 11, 12, 13].map((d) =>
      entry({
        id: `happening:trip@2026-09-${d}`,
        kind: "happening",
        day: day(2026, 9, d),
        title: "Away",
      }),
    );
    const events = toFeedEvents(days, TZ);
    expect(events).toHaveLength(1);
    expect(events[0].date).toEqual(day(2026, 9, 10));
    expect(events[0].lastDate).toEqual(day(2026, 9, 13));
  });

  it("keeps two people's trips apart even under identical words", () => {
    const events = toFeedEvents(
      [
        entry({ id: "happening:a@2026-09-10", kind: "happening", day: day(2026, 9, 10), title: "Away" }),
        entry({ id: "happening:b@2026-09-20", kind: "happening", day: day(2026, 9, 20), title: "Away" }),
      ],
      TZ,
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.date)).toEqual([day(2026, 9, 10), day(2026, 9, 20)]);
  });

  it("leaves a one-day happening without an end date", () => {
    const [event] = toFeedEvents(
      [entry({ id: "happening:x@2026-09-10", kind: "happening", day: day(2026, 9, 10) })],
      TZ,
    );
    expect(event.lastDate).toBeUndefined();
  });

  it("recovers the row from an expanded id, and leaves a plain one alone", () => {
    expect(entryRowKey("happening:abc@2026-09-10")).toBe("happening:abc");
    expect(entryRowKey("task:abc")).toBe("task:abc");
  });
});

describe("times", () => {
  it("resolves a plan's local minute against the account's timezone", () => {
    // 19:00 in New York on 6 September 2026 is 23:00 UTC — the reading is off a
    // clock in that zone, so resolving it anywhere else moves the evening.
    const [event] = toFeedEvents(
      [
        entry({
          id: "plan:1",
          kind: "plan",
          day: day(2026, 9, 6),
          title: "Dinner",
          minute: 19 * 60,
          durationMinutes: 90,
        }),
      ],
      TZ,
    );
    expect(event.timed?.start.toISOString()).toBe("2026-09-06T23:00:00.000Z");
    expect(event.timed?.end?.toISOString()).toBe("2026-09-07T00:30:00.000Z");
  });

  it("gives no end to a plan that records no length, rather than inventing one", () => {
    const [event] = toFeedEvents(
      [entry({ id: "plan:2", kind: "plan", day: day(2026, 9, 6), minute: 19 * 60 })],
      TZ,
    );
    expect(event.timed?.start).toBeInstanceOf(Date);
    expect(event.timed?.end).toBeUndefined();
  });

  it("leaves a plan with no time as an all-day event", () => {
    const [event] = toFeedEvents(
      [entry({ id: "plan:3", kind: "plan", day: day(2026, 9, 6) })],
      TZ,
    );
    expect(event.timed).toBeUndefined();
  });

  it("never emits a recurrence rule — occurrences arrive already expanded", () => {
    // A recurring birthday reaches the feed as one entry per year in the
    // window. Emitting an RRULE as well would lay an endless second copy of
    // every birthday on top of the first.
    const events = toFeedEvents(
      [entry({ id: "date:1@2026-11-02", kind: "date", day: day(2026, 11, 2) })],
      TZ,
    );
    expect(events[0].recurrence).toBe("NONE");
  });
});

describe("the document", () => {
  it("writes a timed event in UTC and a span with an exclusive end", () => {
    const document = icsDocument(
      toFeedEvents(
        [
          entry({ id: "plan:1", kind: "plan", day: day(2026, 9, 6), title: "Dinner", minute: 19 * 60, durationMinutes: 60 }),
          entry({ id: "happening:t@2026-09-10", kind: "happening", day: day(2026, 9, 10), title: "Away" }),
          entry({ id: "happening:t@2026-09-11", kind: "happening", day: day(2026, 9, 11), title: "Away" }),
        ],
        TZ,
      ),
      2026,
      STAMP,
      { name: "Personal CRM" },
    );

    expect(document).toContain("DTSTART:20260906T230000Z");
    expect(document).toContain("DTEND:20260907T000000Z");
    expect(document).toContain("DTSTART;VALUE=DATE:20260910");
    // Exclusive: the day after the last day it covers.
    expect(document).toContain("DTEND;VALUE=DATE:20260912");
    expect(document).toContain("X-WR-CALNAME:Personal CRM");
  });

  it("gives every event a UID that survives a refetch", () => {
    const document = icsDocument(
      toFeedEvents([entry({ id: "task:abc", kind: "task", day: day(2026, 9, 6) })], TZ),
      2026,
      STAMP,
    );
    expect(document).toContain("UID:personalcrm-task:abc");
  });
});
