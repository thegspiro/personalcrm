import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Places are reached from an interaction, not created directly, so this walks
 * the way someone actually gets one: log a visit with a venue, add a second
 * person to that same visit, then read the place back.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

// The projects share one database, so every name is stamped per project.
const first = () => `LocAda ${test.info().project.name} ${STAMP}`;
const second = () => `LocGrace ${test.info().project.name} ${STAMP}`;
const place = () => `Corner Cafe ${test.info().project.name} ${STAMP}`;
const title = () => `Shared visit ${test.info().project.name} ${STAMP}`;

/** The dialogs carry two contact pickers; only the attendees one is meant. */
function attendees(page: Page, label: string) {
  return page.getByRole("dialog").getByRole("group", { name: label });
}

test("set up the two people this spec works with", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, first());
  await createContact(page, second());
});

test("a visit's place lists everyone who was there", async ({ page }) => {
  await ensureSignedIn(page);

  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(first()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  await sheet.getByLabel("Title").fill(title());
  await sheet.getByLabel("Where").fill(place());
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(title())).toBeVisible();

  // Add the second person to the same visit, so the place has to aggregate
  // across participants rather than just echo whoever logged it.
  await page.goto("/timeline");
  await page.getByRole("button", { name: `Edit ${title()}` }).click();
  const edit = attendees(page, "Who");
  await edit.getByLabel("Search people").fill(second());
  await edit.getByRole("button", { name: second() }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();

  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(place()) }).click();

  await expect(page.getByRole("heading", { name: place() })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(first()) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(second()) })).toBeVisible();
  await expect(page.getByText(title())).toBeVisible();
});
