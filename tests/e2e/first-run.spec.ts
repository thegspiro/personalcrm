import { expect, test } from "@playwright/test";
import { ACCOUNT, FIRST_NAME, completeSetup, isFirstRun } from "./helpers";

/**
 * First-run setup: the state a brand-new Unraid install is in.
 *
 * These skip themselves once an account exists, so the suite can be re-run
 * against a live instance without wiping /config first.
 */
test.describe.configure({ mode: "serial" });

test("a fresh instance sends you to first-run setup", async ({ page }) => {
  test.skip(!(await isFirstRun(page)), "instance is already set up");

  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("setup rejects a weak password", async ({ page }) => {
  test.skip(!(await isFirstRun(page)), "instance is already set up");

  await page.goto("/setup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account & start" }).click();

  await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
});

test("setup creates the account and signs you straight in", async ({ page }) => {
  test.skip(!(await isFirstRun(page)), "instance is already set up");

  await completeSetup(page);
  await expect(page.getByText(`Hi ${FIRST_NAME}`)).toBeVisible();
});

test("setup closes once an account exists", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);
});
