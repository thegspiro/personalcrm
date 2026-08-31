import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

test.describe.configure({ mode: "serial" });
const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const first = () => `LocAlice${test.info().project.name}${STAMP}`.replace(/[^a-z0-9]/gi, "");
const second = () => `LocBob${test.info().project.name}${STAMP}`.replace(/[^a-z0-9]/gi, "");
const place = () => `Together Cafe ${test.info().project.name} ${STAMP}`;

test("set up two participants", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, first());
  await createContact(page, second());
});

test("one visit shows every participant on its location page", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(first()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Coffee", exact: true }).click();
  await dialog.getByLabel("Title").fill(`Shared visit ${STAMP}`);
  await dialog.getByLabel("Where").fill(place());
  await dialog.getByRole("button", { name: "Log it" }).click();

  await page.goto("/timeline");
  const row = page.locator("article").filter({ hasText: `Shared visit ${STAMP}` }).first();
  await row.getByRole("button", { name: new RegExp("Edit") }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Search people").fill(second());
  await edit.getByRole("button", { name: second(), exact: true }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();

  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(place()) }).click();
  await expect(page.getByRole("link", { name: first(), exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: second(), exact: true }).first()).toBeVisible();
  await expect(page.getByText(`Shared visit ${STAMP}`)).toBeVisible();
});
