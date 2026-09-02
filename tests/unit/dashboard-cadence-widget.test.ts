import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverdueWidget } from "@/components/dashboard/widgets";
import type { OverdueContact } from "@/server/queries/dashboard";

// Next injects React for preserved JSX; the Node renderer used directly here
// does not run through Next's compiler.
Object.assign(globalThis, { React });

function contact(id: string, firstName: string, daysUntilDue: number): OverdueContact {
  return {
    id,
    firstName,
    lastName: null,
    avatarPath: null,
    cadenceDays: 7,
    lastInteractionAt: null,
    nextTouchAt: new Date(),
    daysUntilDue,
  };
}

describe("Time to reach out widget", () => {
  it("separates due contacts from chronological upcoming contacts with accurate labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(OverdueWidget, {
        contacts: [
          contact("overdue", "Overdue", -4),
          contact("today", "Today", 0),
          contact("tomorrow", "Tomorrow", 1),
          contact("soon", "Soon", 3),
        ],
      }),
    );

    expect(html).toContain('aria-label="Due now"');
    expect(html).toContain('aria-label="Coming up"');
    expect(html).toContain("4d overdue");
    expect(html).toContain("today");
    expect(html).toContain("tomorrow");
    expect(html).toContain("in 3 days");
    expect(html.indexOf("Overdue")).toBeLessThan(html.indexOf("Tomorrow"));
    expect(html.indexOf("Tomorrow")).toBeLessThan(html.indexOf("Soon"));
  });
});
