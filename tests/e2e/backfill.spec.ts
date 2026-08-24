import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Rapid backfill: the screen for dumping years of history in one sitting.
 * What matters is that context survives between entries.
 */
test.describe.configure({ mode: "serial" });

/** Unique per run so repeat runs never reuse an earlier run's contact. */
const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

test("backfill keeps its context between entries and can undo", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Backfill ${test.info().project.name} ${STAMP}`;

  const contactUrl = await createContact(page, name);
  await page.getByRole("link", { name: "Backfill" }).first().click();
  await page.waitForURL(/\/backfill$/);
  await expect(page.getByRole("heading", { name: `Backfill ${name}` })).toBeVisible();

  // Set the date once, well into the past.
  await page.getByRole("button", { name: "−1 month" }).click();
  await page.getByRole("button", { name: "−1 month" }).click();
  const when = page.getByLabel("When");
  const afterFirstSet = await when.inputValue();

  await page.getByRole("button", { name: "Coffee", exact: true }).click();
  await page.getByLabel("Title").fill("First backfilled entry");
  await page.getByRole("button", { name: "Add and keep going" }).click();

  await expect(page.getByText("First backfilled entry")).toBeVisible();

  // The date survives the save — that is what makes a run of historical
  // entries quick instead of resetting to today each time.
  await expect(when).toHaveValue(afterFirstSet);
  // The title clears, ready for the next one.
  await expect(page.getByLabel("Title")).toHaveValue("");

  await page.getByLabel("Title").fill("Second backfilled entry");
  await page.getByRole("button", { name: "Add and keep going" }).click();
  await expect(page.getByText("Second backfilled entry")).toBeVisible();

  // Undo removes it again.
  await page.getByRole("button", { name: "Undo Second backfilled entry" }).click();
  await expect(page.getByText("Second backfilled entry")).toHaveCount(0);
  await expect(page.getByText("First backfilled entry")).toBeVisible();

  // And it really is gone from the contact's timeline, not just the panel.
  await page.goto(contactUrl);
  await expect(page.getByText("First backfilled entry")).toBeVisible();
  await expect(page.getByText("Second backfilled entry")).toHaveCount(0);
});

test("backfill records a life event at year precision", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Yearly ${test.info().project.name} ${STAMP}`;

  const contactUrl = await createContact(page, name);
  await page.goto(`${contactUrl}/backfill`);

  await page.getByRole("button", { name: /Something that happened to them/ }).click();
  await page.getByLabel("What happened?").fill("Graduated");
  await page.getByRole("button", { name: "When", exact: true }).click();
  await page.getByPlaceholder("2019, March 2019, 3 years ago…").fill("2012");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Add and keep going" }).click();
  // Scope to the session list — "Graduated" is also a <option> in the type select.
  await expect(page.getByRole("button", { name: "Undo Graduated" })).toBeVisible();

  // The year survives the round-trip and is not rendered as January 1st.
  await page.goto(contactUrl);
  const section = page.locator("section").filter({ hasText: "Life events" }).first();
  await expect(section.getByText("Graduated")).toBeVisible();
  await expect(section.getByRole("paragraph").filter({ hasText: /^2012$/ })).toBeVisible();
  await expect(section.getByText(/January 1, 2012/)).toHaveCount(0);
});
