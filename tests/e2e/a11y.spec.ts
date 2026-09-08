import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNT, ensureSignedIn } from "./helpers";

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
