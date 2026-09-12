import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNT, createContact, ensureSignedIn } from "./helpers";

/**
 * Accessibility, checked by axe against the real pages.
 *
 * `layout.spec.ts` already proves no route scrolls sideways and that inputs
 * cannot trigger the iOS zoom. Those are the two mobile failures this project
 * decided not to take on trust; this covers the ones a keyboard or a screen
 * reader hits — labels, roles, contrast, focus order — which nothing measured
 * before.
 *
 * **Serious and critical fail the build. Moderate and minor are printed.**
 * Those two tiers are the ones that stop somebody using the app at all; the
 * lower ones are frequently arguable, and a suite that fails on an arguable
 * finding is one people learn to skip. What is found is reported rather than
 * hidden, so the decision to act stays a decision.
 */

const BLOCKING = new Set(["serious", "critical"]);

/** Excluded from the sweep, with the reason, rather than silently narrowed. */
const EXCLUDE = [
  // Third-party toast markup, injected outside the app's own tree.
  "[data-sonner-toaster]",
];

async function scan(page: Page, label: string) {
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  for (const selector of EXCLUDE) builder = builder.exclude(selector);

  const { violations } = await builder.analyze();

  const blocking = violations.filter((violation) => BLOCKING.has(violation.impact ?? ""));
  const advisory = violations.filter((violation) => !BLOCKING.has(violation.impact ?? ""));

  if (advisory.length > 0) {
    // Printed, not asserted. Read these before deciding they do not matter.
    console.log(
      `[a11y] ${label}: ${advisory.length} advisory — ` +
        advisory.map((v) => `${v.id}(${v.impact}, ${v.nodes.length})`).join(", "),
    );
  }

  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      // axe's own measurement, not just the selector. A contrast failure is
      // unfixable from a selector alone — the numbers say whether the text,
      // the background or the size is the thing to change.
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(" "),
        why: node.failureSummary?.replace(/\s+/g, " ").trim(),
      })),
    })),
    `serious or critical accessibility violations on ${label}`,
  ).toEqual([]);
}

test("the sign-in page is accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await scan(page, "/login");
});

const ROUTES = [
  "/",
  "/people",
  "/timeline",
  "/calendar",
  "/tasks",
  "/ideas",
  "/gifts",
  "/locations",
  "/family",
  "/settings",
  "/more",
];

for (const route of ROUTES) {
  test(`${route} is accessible`, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto(route);
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await scan(page, route);
  });
}

/**
 * A calendar with something on it, which the plain route scan cannot promise.
 *
 * `/calendar` above renders whatever the account happens to hold, so the chips
 * are only scanned when another spec's data lands in the month on show. That is
 * how a contrast failure survived: the suffix inside a chip is drawn only when a
 * happening carries a contact or a note, so the violation appeared or vanished
 * with the date and the order the suites ran in, and a green run proved nothing
 * about it. This puts a chip on today by construction.
 *
 * Dates are computed rather than written down. A fixed day would drift out of
 * the month on show and quietly stop covering anything, which is the failure
 * this test exists to end.
 */
test("the calendar is accessible with something on it", async ({ page }) => {
  await ensureSignedIn(page);

  const iso = (offsetDays: number) => {
    const day = new Date();
    day.setDate(day.getDate() + offsetDays);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };

  const person = `Chip ${test.info().project.name} ${Date.now().toString(36)}`;
  await createContact(page, person);

  // Spanning today rather than sitting on it: the chip then carries both
  // suffixes — the contact's name and the "ongoing" note — and today's square
  // is on every grid, whichever month is showing.
  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();
  await section.getByLabel("What have they got on?").fill(`Away ${person}`);
  for (const [label, value] of [["When", iso(-1)], ["Until", iso(1)]] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const typed = page.getByLabel("Type a date");
    await typed.fill(value);
    await typed.press("Enter");
    await expect(typed).toBeHidden();
  }
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByText(`Away ${person}`, { exact: true })).toBeVisible();

  await page.goto("/calendar");
  // The chip has to be on screen before axe measures it, or this passes by
  // scanning a calendar with nothing on it — exactly the hole it closes.
  await expect(page.getByRole("link", { name: new RegExp(`Away ${person}`) }).first()).toBeVisible();
  await scan(page, "/calendar with entries");
});

test("the person form is accessible", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people/new");
  await expect(page.getByLabel("First name")).toBeVisible();
  await scan(page, "/people/new");
});

test("the two-factor screens are accessible", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();

  // The enrolment panel, which is only in the tree once setup has begun.
  await page.getByLabel("Confirm your password to begin").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Set up" }).click();
  await expect(page.getByLabel("2. Enter the code it shows")).toBeVisible();
  await scan(page, "two-factor enrolment");
});

/**
 * The calendar the "When" field opens, which no route scan reaches.
 *
 * It is a popover inside a sheet, so it exists only after two clicks and is
 * portalled outside the page — everything above walks routes and would report
 * it clean without ever having rendered it. What is being checked is the part
 * that is easy to get wrong by hand: an ARIA grid whose rows and cells have to
 * nest in one particular way, an icon-only button that needs a name of its
 * own, and a selected day whose colours are not the ones the rest of the app
 * was measured on.
 */
test("the date-and-time calendar is accessible", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Log an interaction" }).click();
  await page.getByRole("button", { name: "Open calendar" }).click();
  await expect(page.getByRole("grid")).toBeVisible();

  await scan(page, "the date-and-time calendar");
});
