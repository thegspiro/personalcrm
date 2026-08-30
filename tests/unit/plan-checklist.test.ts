import { describe, expect, it } from "vitest";
import {
  planChecklistSchema,
  readPlanChecklist,
  STARTER_PLAN_CHECKLIST,
} from "@/lib/plan-checklist";

describe("plan checklists", () => {
  it("offers editable suggestions without claiming any are done", () => {
    expect(STARTER_PLAN_CHECKLIST.map((item) => item.text)).toEqual([
      "Confirm availability",
      "Reserve or buy tickets",
      "Check travel time",
      "Agree on budget",
      "Choose a fallback",
    ]);
    expect(STARTER_PLAN_CHECKLIST.every((item) => !item.completed)).toBe(true);
  });

  it("accepts the stored shape and rejects malformed or duplicate items", () => {
    const valid = [{ id: "travel", text: "Check travel time", completed: true }];
    expect(planChecklistSchema.parse(valid)).toEqual(valid);
    expect(readPlanChecklist([{ id: "travel", text: "", completed: false }])).toEqual([]);
    expect(
      planChecklistSchema.safeParse([
        { id: "same", text: "One", completed: false },
        { id: "same", text: "Two", completed: false },
      ]).success,
    ).toBe(false);
  });
});
