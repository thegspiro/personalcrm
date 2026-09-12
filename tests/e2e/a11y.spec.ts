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

/**
 * States that are drawn recessed, which the route scans cannot promise.
 *
 * A settled debt and something that is over are both drawn set back from the
 * rows around them. Until recently each did that by fading its own text, which
 * put an 11px amount at 2.9 and a date at 2.4 against a 4.5 threshold — and
 * neither was ever measured, because the scans above read whatever the account
 * happens to hold and these rows only exist once something has been settled or
 * has finished. That is the same blind spot that let the calendar chip through.
 * Both states are now created deliberately, then scanned.
 *
 * Only a state that changes how something is drawn needs a fixture. The other
 * sites the sweep found — the count inside a pipeline pill, the "· 12d" on a
 * quiet contact, the pager's ellipsis — now carry no conditional styling at
 * all, so every render of them is already covered above.
 */
test("a profile is accessible with rows that have been set back", async ({ page }) => {
  await ensureSignedIn(page);

  const iso = (offsetDays: number) => {
    const day = new Date();
    day.setDate(day.getDate() + offsetDays);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };

  const person = `Recessed ${test.info().project.name} ${Date.now().toString(36)}`;
  await createContact(page, person);

  // A settled debt: the row stays, set back, with its description struck through.
  await page.getByRole("button", { name: /^Lent and borrowed/ }).click();
  await page.getByRole("button", { name: "Add a debt" }).click();
  await page.getByLabel("What was it?").fill("Covered lunch");
  await page.getByLabel("How much?").fill("25");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Mark settled" }).first().click();
  // The disclosure is what puts the settled row in the tree at all.
  await page.getByRole("button", { name: /\d+ settled/ }).click();
  await expect(page.getByText("Covered lunch")).toBeVisible();

  // Something that is over: dated wholly in the past, so its phase is "ended".
  const happenings = page.locator("section#happenings");
  await happenings.scrollIntoViewIfNeeded();
  await happenings.getByRole("button", { name: "Add something they have on" }).click();
  await happenings.getByLabel("What have they got on?").fill("Trip that has been");
  for (const [label, value] of [["When", iso(-30)], ["Until", iso(-20)]] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const typed = page.getByLabel("Type a date");
    await typed.fill(value);
    await typed.press("Enter");
    await expect(typed).toBeHidden();
  }
  await happenings.getByRole("button", { name: "Add", exact: true }).click();
  await expect(happenings.getByText("Trip that has been", { exact: true })).toBeVisible();

  await scan(page, "a profile with rows set back");
});

/**
 * A type that has been switched off.
 *
 * It is drawn in neutral colours rather than as a faded coloured pill, which is
 * what the sweep changed: dimming the pill took its label from 4.6 to 2.2. The
 * term is created and deleted inside this test rather than switching an
 * existing one off, because types are account-wide and the three projects share
 * one account — leaving a default type off would change what every later spec
 * sees in its dropdowns.
 */
test("settings is accessible with a type switched off", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Types" }).click();

  const label = `Off ${test.info().project.name} ${Date.now().toString(36)}`;
  // A section's add control is its own header button, and opens the section with
  // it — the group titles are not headings, so they cannot be located by role.
  await page.getByRole("button", { name: "Add to fact categories" }).click();
  await page.getByLabel("Name").fill(label);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(label).first()).toBeVisible();

  await page.getByRole("button", { name: `Edit ${label}` }).click();
  await page.getByRole("button", { name: "Turn off" }).click();
  // "Off ·" in the line below the pill is the state the colour used to repeat.
  await expect(page.getByText("Off ·").first()).toBeVisible();

  await scan(page, "settings with a type switched off");

  // Put the account back as it was found. The term is unused, so it can be
  // deleted outright, and its edit form is the only one open on the page.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(label)).toHaveCount(0);
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
