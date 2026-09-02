import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasksWidget, type TaskRow } from "@/components/dashboard/widgets";

// The application is compiled by Next with the automatic JSX runtime. Vitest
// preserves JSX in imported components, so expose React for those otherwise
// implicit classic-runtime calls while rendering this server component.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(tasks: TaskRow[]) {
  return renderToStaticMarkup(React.createElement(TasksWidget, { tasks }));
}

describe("TasksWidget", () => {
  it("gives a contact task one descriptive, keyboard-focusable route to its tasks", () => {
    const html = render([
      {
        id: "task-1",
        title: "Return the borrowed book",
        dueDate: null,
        contact: { id: "contact-1", firstName: "Avery", lastName: "Ng" },
      },
    ]);

    expect(html).toContain('href="/people/contact-1#tasks"');
    expect(html).toContain('aria-label="Return the borrowed book — follow up with Avery Ng"');
    // One row, one native link: there is no nested or competing target for a
    // keyboard or screen-reader user to interpret.
    expect(html.match(/<li[\s\S]*?<\/li>/)?.[0].match(/<a /g)).toHaveLength(1);
    expect(html).toContain("focus-visible:ring-2");
  });

  it("routes a task without a contact past the people section, to the task list", () => {
    const html = render([
      { id: "task-2", title: "Renew membership", dueDate: null, contact: null },
    ]);

    // Not bare "/tasks": the hub opens on "People to contact", which can run to
    // a couple of hundred rows, leaving the task the reader clicked offscreen.
    expect(html).toContain('href="/tasks#things-to-do"');
    expect(html).toContain('aria-label="Renew membership — view in Follow-ups"');
    expect(html).not.toContain("/people/");
  });

  it("keeps long row content shrinkable at narrow widths", () => {
    const html = render([
      {
        id: "task-3",
        title: "A very long follow-up that must not force a mobile viewport wider",
        dueDate: null,
        contact: { id: "contact-3", firstName: "Alexandria", lastName: "Featherstonehaugh" },
      },
    ]);

    expect(html).toMatch(/<li class="min-w-0"><a[^>]+class="[^"]*min-w-0/);
    expect(html).toContain('class="min-w-0 flex-1"');
    expect(html).toContain("truncate text-sm");
    expect(html).toContain("truncate text-xs");
  });
});
