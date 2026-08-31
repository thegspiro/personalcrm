import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

test("a plan checklist can be created, edited, checked and deleted without mobile overflow", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Picnic checklist ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await plans.getByLabel("Checklist item 1", { exact: true }).fill("Confirm Sunday availability");
  await plans.getByLabel("Mark Confirm Sunday availability complete").check();
  await plans.getByLabel("Delete checklist item 2").click();
  await plans.getByRole("button", { name: "Add item" }).click();
  await plans.getByLabel("Checklist item 5", { exact: true }).fill("Pack a picnic blanket");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  let row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.getByLabel("Checklist item 1", { exact: true })).toHaveValue("Confirm Sunday availability");
  await expect(plans.getByLabel("Mark Confirm Sunday availability complete")).toBeChecked();
  await expect(plans.locator('input[value="Reserve or buy tickets"]')).toHaveCount(0);
  await expect(plans.locator('input[value="Pack a picnic blanket"]')).toBeVisible();

  await plans.getByLabel("Delete checklist item 5").click();
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.locator('input[value="Pack a picnic blanket"]')).toHaveCount(0);
});
