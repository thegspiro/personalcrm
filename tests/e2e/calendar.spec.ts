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

  // Through the day view, not the month, and that is the point. A grid square
  // holds three entries before it would scroll, so on an account with a busy
  // today the month grid legitimately shows "+n more" instead of this plan —
  // which is how the first run of this test failed, on desktop only. The day
  // view is complete and renders at every width, so it is both the honest
  // assertion and the thing a reader would actually click through to.
  //
  // The day is read from the browser, because that is the clock chrono parsed
  // "today" against a moment ago in the form above.
  const today = await page.evaluate(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  });

  await page.goto(`/calendar?day=${today}`);
  // Scoped to the day section, and it has to be: the plan is now rendered
  // twice at every width — once here and once in the grid or the month agenda
  // behind it — so an unscoped locator is a strict-mode violation rather than
  // a passing assertion. Scoping also makes the test say what it means, which
  // is that the day view is the complete one.
  // By the section's own attribute, not by "a section containing that
  // heading": the day view used to be nested inside the month's section, so
  // the containment filter matched the outer one too and picked up the agenda
  // behind it. The markup is siblings now and the locator names one element.
  const daySection = page.locator("section[aria-labelledby='calendar-day-heading']");
  await expect(daySection.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("a day opens from the grid and closes again", async ({ page }) => {
  // Desktop only: the grid is what links into a day, and it is hidden on a
  // phone, where the month agenda already lists every day in full.
  test.skip(
    test.info().project.name !== "desktop",
    "the month grid is a desktop-width view",
  );

  await ensureSignedIn(page);
  await page.goto("/calendar");

  const today = await page.evaluate(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  });

  await page.getByRole("link", { name: `Everything on ${today}` }).click();
  // By id: the month heading is also an h3, and positional matching between
  // two headings is the kind of locator that passes until it does not.
  await expect(page.locator("#calendar-day-heading")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`day=${today}`));

  await page.getByRole("link", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/day=/);
});
