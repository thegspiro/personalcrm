import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * The calendar, through the controls.
 *
 * `tests/e2e/layout.spec.ts` already covers the thing most likely to go wrong
 * with a seven-column grid — that no route scrolls sideways — because
 * `/calendar` is in its route list. What is left for here is that the month
 * actually renders, that stepping between months works, and that something
 * dated reaches the square it belongs in.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test("the calendar shows the month and steps between them", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/calendar");

  await expect(page.getByRole("heading", { name: "Calendar", level: 2 })).toBeVisible();

  const now = new Date();
  const thisMonth = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  await expect(page.getByRole("heading", { name: thisMonth, level: 3 })).toBeVisible();

  // Stepping is three ordinary links, so the month is in the URL and the back
  // button works. Next then previous has to land back where it started.
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(
    page.getByRole("heading", {
      name: `${MONTHS[next.getMonth()]} ${next.getFullYear()}`,
      level: 3,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: thisMonth, level: 3 })).toBeVisible();

  // "Today" is offered only while looking at another month — a link back to
  // where you already are is noise.
  await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
});

test("something pencilled in for today reaches the calendar", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Calendar round-trip ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);

  // The day goes in through the popover's own text box: `DateField` portals its
  // content, so the trigger is inside the form and everything it opens is at
  // page scope. Enter commits and closes.
  await plans.getByRole("button", { name: "Pencilled in for", exact: true }).click();
  const day = page.getByLabel("Type a date");
  await day.fill("today");
  await day.press("Enter");
  await expect(day).toBeHidden();

  await plans.getByRole("button", { name: "Save", exact: true }).click();
  await expect(plans.getByText(title)).toBeVisible();

  await page.goto("/calendar");
  // Both readings render — the grid on a desktop, the agenda on a phone — and
  // only one is visible at a time, so this asserts on whichever the project's
  // viewport shows rather than on a count.
  await expect(page.getByRole("link", { name: new RegExp(title) }).first()).toBeVisible();
});
