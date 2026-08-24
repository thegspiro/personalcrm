import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * The dating module end to end: profile, dates, flags, pipeline, compare,
 * ending, and converting back to an ordinary contact.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

function personName(): string {
  return `Dating ${test.info().project.name} ${STAMP}`;
}

let contactUrl = "";

test("mark someone as dating and fill in their profile", async ({ page }) => {
  await ensureSignedIn(page);
  contactUrl = await createContact(page, personName());

  // The dating sections only appear once they're flagged as romantic.
  await page.goto(`${contactUrl}/edit`);
  await page.getByText("Dating or interested").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(contactUrl);

  const dating = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "End it" }).or(page.getByLabel("Private notes")) })
    .first();
  await expect(dating).toBeVisible();

  await dating.getByRole("button", { name: "Talking", exact: true }).click();
  await dating.getByLabel("Relationship style").fill("Monogamous");
  await dating.getByLabel("Private notes").fill("Funnier over text than in person.");
  await dating.getByRole("button", { name: "Save", exact: true }).click();

  await expect(dating.getByText("Monogamous")).toBeVisible();
});

test("log three dates, one of them backdated into the middle", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  // Scope by the add button rather than the title: `hasText` is
  // case-insensitive, so "Dates" also matches the "Important dates" section.
  const dates = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Log a date" }) })
    .first();

  async function logDate(venue: string, monthsBack: number) {
    await dates.getByRole("button", { name: "Log a date" }).click();
    await dates.getByRole("button", { name: "Coffee", exact: true }).click();
    for (let i = 0; i < monthsBack; i++) {
      await dates.getByRole("button", { name: "−1 month" }).click();
    }
    await dates.getByLabel("Where").fill(venue);
    await dates.getByRole("button", { name: "Log it" }).click();
    await expect(dates.getByText(venue)).toBeVisible();
  }

  await logDate("Oldest Cafe", 3);
  await logDate("Newest Bar", 0);
  // Remembered late, but it happened in between the other two.
  await logDate("Middle Diner", 1);

  // Sequence follows when dates happened, not the order they were entered.
  await expect(dates.getByText("Date 1 — Oldest Cafe")).toBeVisible();
  await expect(dates.getByText("Date 2 — Middle Diner")).toBeVisible();
  await expect(dates.getByText("Date 3 — Newest Bar")).toBeVisible();
});

test("dates appear in the unified timeline", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const timeline = page.locator("section").filter({ hasText: "Timeline" }).first();
  await expect(timeline.getByText(/Middle Diner/).first()).toBeVisible();
});

test("add green and red flags", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const flags = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add a flag" }) })
    .first();

  await flags.getByRole("button", { name: "Add a flag" }).click();
  await flags.getByRole("button", { name: "Green" }).click();
  await flags.getByLabel("What did you notice?").fill("Kind to waiters without thinking about it");
  await flags.getByRole("button", { name: "Add", exact: true }).click();
  await expect(flags.getByText("GREEN FLAGS")).toBeVisible();

  await flags.getByRole("button", { name: "Add a flag" }).click();
  await flags.getByRole("button", { name: "Red" }).click();
  await flags.getByLabel("What did you notice?").fill("Cancelled twice with an hour's notice");
  await flags.getByRole("button", { name: "Add", exact: true }).click();
  await expect(flags.getByText("RED FLAGS")).toBeVisible();
});

test("the pipeline groups them by stage and can move them", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName();

  await page.goto("/dating");
  const card = page.locator("li").filter({ hasText: name }).first();
  await expect(card).toBeVisible();

  // Move them along; the section they sit in changes with them.
  await card.getByRole("combobox", { name: new RegExp(`Stage for ${name}`) }).selectOption({ label: "Dating" });
  await expect(page.getByRole("heading", { name: "Dating", level: 3 })).toBeVisible();
});

test("compare sorts and opens a side-by-side", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/dating/compare");

  const table = page.locator("table").first();
  await expect(table).toBeVisible();
  await table.getByRole("button", { name: /Dates/ }).click();

  const rows = page.getByRole("checkbox");
  const count = await rows.count();
  test.skip(count < 2, "needs at least two people in the pipeline");

  await rows.nth(0).click();
  await rows.nth(1).click();
  await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible();
});

test("ending records the reason and the retrospective separately", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const dating = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "End it" }) })
    .first();
  await dating.getByRole("button", { name: "End it" }).click();

  await page.getByLabel("What happened?").fill("She's moving to Chicago.");
  await page.getByLabel("Looking back").fill("I waited too long to say what I wanted.");
  await page.getByRole("button", { name: "Record it" }).click();

  await expect(dating.getByText("Why it ended")).toBeVisible();
  await expect(dating.getByText("Looking back")).toBeVisible();
});

test("converting to a friend keeps the history", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Just a friend" }).click();

  // The dating sections go, but everything logged is still there.
  // Target the section's own add button: `hasText` is case-insensitive, so
  // filtering sections on "Dates" would also match "Important dates".
  await expect(page.getByRole("button", { name: "Log a date" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a flag" })).toHaveCount(0);
  const timeline = page.locator("section").filter({ hasText: "Timeline" }).first();
  await expect(timeline.getByText(/Middle Diner/).first()).toBeVisible();

  // And they've left the pipeline.
  await page.goto("/dating");
  await expect(page.getByText(personName())).toHaveCount(0);
});
