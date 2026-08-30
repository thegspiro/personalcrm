import { expect, test, type Page } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Creating a person and recording things about them, including things that
 * happened in the past.
 */
test.describe.configure({ mode: "serial" });

/**
 * Unique per run as well as per project: the suite is designed to run against
 * an instance that already has data, so reusing a name would make a second run
 * pick up the contact the first run created.
 */
const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

function personName(_page: Page): string {
  return `Backdate ${test.info().project.name} ${STAMP}`;
}

async function openPerson(page: Page, name: string) {
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("create a contact with a keep-in-touch cadence", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);

  await page.goto("/people/new");
  await page.getByLabel("First name").fill(name);
  await page.getByLabel("Last name").fill("Case");
  await page.getByLabel("Remind me to reach out").selectOption({ label: "Every 2 weeks" });
  await page.getByRole("button", { name: "Add person" }).click();

  await expect(page.getByRole("heading", { name: `${name} Case`, level: 2 })).toBeVisible();
  await expect(page.getByText("Every 2 weeks")).toBeVisible();
});

test("a backdated interaction does not reset the cadence", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);
  await openPerson(page, `${name} Case`);

  await page.getByRole("button", { name: "Log interaction" }).click();
  await expect(page.getByRole("heading", { name: "Log an interaction" })).toBeVisible();

  await page.getByRole("button", { name: "Coffee", exact: true }).click();

  // 90 days ago — three taps of the month preset.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "−1 month" }).click();
  }
  await page.getByLabel("Title").fill("Coffee from months ago");
  await page.getByRole("button", { name: "Log it" }).click();

  // The interaction is recorded...
  await expect(page.getByText("Coffee from months ago")).toBeVisible();

  // ...but it happened long enough ago that a 14-day cadence is still overdue.
  // If activity were assigned from the row just written instead of recomputed
  // from history, this person would wrongly look freshly contacted.
  await expect(page.getByText(/Overdue by/)).toBeVisible();
  await expect(page.getByText("Spoke today")).toHaveCount(0);
});

test("they remain on the overdue list", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);

  // The dashboard widget only shows the most overdue handful, so assert on the
  // full overdue-sorted list — the point is that backdating did not clear them.
  await page.goto("/people?sort=overdue");
  await expect(page.getByRole("link", { name: new RegExp(`${name} Case`) })).toBeVisible();

  // And the widget itself renders with entries rather than the empty state.
  await page.goto("/");
  const widget = page.getByTestId("widget-overdue");
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("link")).not.toHaveCount(0);
});

test("record a life event known only to the year", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);
  await openPerson(page, `${name} Case`);

  const section = page.locator("section").filter({ hasText: "Significant moments" }).first();
  await section.getByRole("button", { name: /Add/ }).click();

  await section.getByLabel("What happened?").fill("Moved to Denver");
  await section.getByRole("button", { name: "When", exact: true }).click();
  await page.getByPlaceholder("2019, March 2019, 3 years ago…").fill("2019");
  await page.keyboard.press("Enter");
  await section.getByRole("button", { name: "Add", exact: true }).click();

  // The whole point of precision: a year stays a year. Scope to the saved row —
  // the add form's own date trigger also reads "2019" until it is dismissed.
  await expect(section.getByText("Moved to Denver")).toBeVisible();
  // The saved row renders the date in a <p>; the add form's date trigger is a
  // <button>, so targeting the paragraph avoids matching both.
  await expect(
    section.getByRole("paragraph").filter({ hasText: /^2019$/ }),
  ).toBeVisible();
  await expect(section.getByText(/January 1, 2019/)).toHaveCount(0);
});

test("record a fact and a follow-up", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);
  await openPerson(page, `${name} Case`);

  const facts = page.locator("section").filter({ hasText: "Things to know" }).first();
  await facts.getByRole("button", { name: /Add/ }).click();
  await facts.getByLabel("What should you remember?").fill("Hates coriander with a passion");
  await facts.getByRole("button", { name: "Add", exact: true }).click();
  await expect(facts.getByText("Hates coriander with a passion")).toBeVisible();

  const tasks = page.locator("section").filter({ hasText: "Follow-ups" }).first();
  await tasks.getByRole("button", { name: /Add/ }).click();
  await tasks.getByLabel("What do you need to do?").fill("Send the Denver recommendations");
  await tasks.getByRole("button", { name: "Add", exact: true }).click();
  await expect(tasks.getByText("Send the Denver recommendations")).toBeVisible();
});

test("save something to do with an ordinary friend", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName(page);
  await openPerson(page, `${name} Case`);

  // Nothing romantic about this person: things to do are not a dating section.
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(`Hike Old Rag ${STAMP}`);
  await plans.getByRole("button", { name: "Outdoors", exact: true }).click();
  await plans.getByLabel("Where").fill("Old Rag Mountain");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  await expect(plans.getByText(`Hike Old Rag ${STAMP}`)).toBeVisible();
  await expect(plans.getByText("Old Rag Mountain")).toBeVisible();

  // And it reaches the general list, beside the conversation ideas.
  await page.goto("/ideas");
  await expect(page.getByText(`Hike Old Rag ${STAMP}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring this up" })).toBeVisible();
});

test("everything shows on the global timeline", async ({ page }) => {
  await ensureSignedIn(page);

  await page.goto("/timeline");
  // Earlier runs leave entries with the same titles, so assert on presence
  // rather than uniqueness.
  await expect(page.getByText("Coffee from months ago").first()).toBeVisible();
  await expect(page.getByText("Moved to Denver").first()).toBeVisible();

  // The fuzzy-dated life event is flagged as approximate rather than given a
  // false relative date like "6 years ago".
  const lifeEvent = page.locator("article").filter({ hasText: "Moved to Denver" }).first();
  await expect(lifeEvent.getByText("approximate")).toBeVisible();
  await expect(lifeEvent.getByText("2019")).toBeVisible();
});

test("timeline filters narrow the feed", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");

  await page.getByRole("button", { name: "Significant moments" }).click();
  await expect(page.getByText("Moved to Denver").first()).toBeVisible();
  await expect(page.getByText("Coffee from months ago")).toHaveCount(0);

  await page.getByRole("button", { name: "Everything" }).click();
  await expect(page.getByText("Coffee from months ago").first()).toBeVisible();
});
