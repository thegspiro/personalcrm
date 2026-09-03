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

  // The editor closes only once the refreshed row has rendered, and its Save
  // button stays disabled until then: React renders the refresh together
  // with the update that ends the form's pending state, so the form is
  // pending for as long as the refresh takes, and a second click — which
  // would save the same form twice — is not possible. The refresh is slowed
  // so that window is wide enough to look at.
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (headers["rsc"] === "1" && !headers["next-action"]) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const save = plans.getByRole("button", { name: "Save", exact: true });
  const editor = plans.getByLabel("What do you want to do?");
  const clicked = Date.now();
  await save.click();
  await expect(save).toBeDisabled();
  let polls = 0;
  for (;;) {
    if (!(await editor.isVisible())) break;
    const enabled = await save.isEnabled({ timeout: 200 }).catch(() => false);
    expect(enabled, "Save re-enabled while the editor was still open").toBe(false);
    polls += 1;
    await page.waitForTimeout(25);
  }
  await page.unroute("**/*");
  // The slowed refresh is what makes the assertion above mean anything: an
  // editor that closed before the delay elapsed was not waiting on it.
  expect(Date.now() - clicked, "the editor closed before the slowed refresh could have landed").toBeGreaterThanOrEqual(1500);
  expect(polls, "the editor was never seen open with its save returned").toBeGreaterThan(5);

  // Waiting for it to close is waiting for the save to be reflected.
  // Reopening it straight away used to show — and could save back — the
  // checklist as it was before the edit; this reopen is what guards that.
  await expect(editor).toBeHidden();
  row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.locator('input[value="Pack a picnic blanket"]')).toHaveCount(0);
});
