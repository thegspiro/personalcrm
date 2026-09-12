import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarPicker } from "@/components/form/calendar-picker";

// Next injects React for preserved JSX; the Node renderer used directly here
// does not run through Next's compiler.
Object.assign(globalThis, { React });

/**
 * The grid as it is actually handed to a browser.
 *
 * `tests/unit/calendar-grid.test.ts` proves the arithmetic; this proves the
 * markup carries it. The ARIA structure is the part worth pinning: a `grid`
 * whose rows are not `row`s, or forty-two tab stops instead of one, is invalid
 * to a screen reader and unusable from a keyboard, and neither shows up in a
 * screenshot.
 */
const TODAY = { year: 2026, month: 9, day: 12 };

function render(props: Partial<React.ComponentProps<typeof CalendarPicker>> = {}) {
  return renderToStaticMarkup(
    React.createElement(CalendarPicker, {
      value: { year: 2026, month: 9, day: 11 },
      today: TODAY,
      onSelect: () => {},
      ...props,
    }),
  );
}

describe("the picker grid", () => {
  it("draws six full weeks of the selected month", () => {
    const html = render();
    expect(html).toContain(">September 2026<");
    expect((html.match(/role="row"/g) ?? []).length).toBe(7); // Headings plus six weeks.
    expect((html.match(/role="gridcell"/g) ?? []).length).toBe(42);
    expect((html.match(/role="columnheader"/g) ?? []).length).toBe(7);
  });

  it("marks the selected day and today as different things", () => {
    const html = render();
    // A day can be both, and the ring that means "today" must not be the only
    // signal on a day that is also selected.
    expect(html).toContain('data-day="2026-09-11"');
    expect(html).toMatch(/aria-selected="true"[\s\S]{0,400}?data-day="2026-09-11"/);
    expect(html).toMatch(/data-day="2026-09-12"[^>]*aria-current="date"/);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-current="date"/g) ?? []).length).toBe(1);
  });

  it("gives the whole month one tab stop, on the selected day", () => {
    const html = render();
    expect((html.match(/tabindex="0"/gi) ?? []).length).toBe(1);
    expect(html).toMatch(/data-day="2026-09-11"[^>]*tabindex="0"/i);
  });

  it("falls back to today's month when nothing is selected", () => {
    const html = render({ value: null });
    expect(html).toContain(">September 2026<");
    expect(html).not.toContain('aria-selected="true"');
    // The tab stop still has to land somewhere, or the grid is unreachable.
    expect((html.match(/tabindex="0"/gi) ?? []).length).toBe(1);
    expect(html).toMatch(/data-day="2026-09-12"[^>]*tabindex="0"/i);
  });

  it("rotates the columns to the account's first day of the week", () => {
    const sunday = render();
    const monday = render({ weekStartsOn: 1 });
    expect(sunday.indexOf(">Su<")).toBeLessThan(sunday.indexOf(">Mo<"));
    expect(monday.indexOf(">Mo<")).toBeLessThan(monday.indexOf(">Su<"));
    // September 2026 starts on a Tuesday, so the leading squares differ.
    expect(sunday).toContain('data-day="2026-08-30"');
    expect(monday).toContain('data-day="2026-08-31"');
  });

  it("names every day in full, because the number alone says nothing aloud", () => {
    expect(render()).toContain('aria-label="Friday, September 11, 2026"');
  });

  it("labels a day by its calendar date, not by the renderer's timezone", () => {
    // `Date.UTC` read back through a local formatter names the day before for
    // anyone west of Greenwich, which would make the whole grid off by one.
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(render()).toContain('aria-label="Friday, September 11, 2026"');
    } finally {
      process.env.TZ = previous;
    }
  });
});
