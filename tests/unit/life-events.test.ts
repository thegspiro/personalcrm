import { describe, expect, it } from "vitest";
import { recentMilestones } from "@/lib/life-events";

const event = (title: string, year: number, isMilestone = false) => ({
  title,
  date: { year, month: 1, day: 1 },
  isMilestone,
});

describe("recentMilestones", () => {
  it("keeps an older milestone prominent despite newer ordinary events", () => {
    const events = [
      event("Coffee yesterday", 2026),
      event("Changed teams", 2025),
      event("Moved abroad", 2019, true),
    ];

    expect(recentMilestones(events).map(({ title }) => title)).toEqual([
      "Moved abroad",
    ]);
    // Pinning is a second view, not a move out of chronological history.
    expect(events.map(({ title }) => title)).toContain("Moved abroad");
  });

  it("removes an event from the summary when its milestone marker is cleared", () => {
    const milestone = event("Graduated", 2020, true);
    expect(recentMilestones([milestone])).toHaveLength(1);

    expect(recentMilestones([{ ...milestone, isMilestone: false }])).toEqual(
      [],
    );
  });

  // A profile concatenates the events recorded against a contact with the ones
  // they only take part in. Each list arrives newest-first, but joining two
  // ordered lists does not make one: every shared event trailed every private
  // one whatever its date, so a recent shared milestone lost its place to three
  // older ones.
  it("interleaves milestones from two separately ordered lists", () => {
    const ownEvents = [event("Moved abroad", 2024, true), event("New job", 2018, true)];
    const sharedEvents = [event("Married", 2025, true), event("Met", 2020, true)];

    expect(
      recentMilestones([...ownEvents, ...sharedEvents]).map(({ title }) => title),
    ).toEqual(["Married", "Moved abroad", "Met"]);
  });

  it("shows only the three most recent milestones", () => {
    const events = [2018, 2022, 2020, 2024].map((year) =>
      event(String(year), year, true),
    );
    expect(recentMilestones(events).map(({ title }) => title)).toEqual([
      "2024",
      "2022",
      "2020",
    ]);
  });
});
