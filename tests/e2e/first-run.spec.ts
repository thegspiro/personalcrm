import { expect, test } from "@playwright/test";
import { ACCOUNT, FIRST_NAME, isFirstRun, skipOnboardingIfShown } from "./helpers";

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
  await expect(page.getByText("Step 1 of 5")).toBeVisible();
});

test("setup rejects a weak password", async ({ page }) => {
  test.skip(!(await isFirstRun(page)), "instance is already set up");

  await page.goto("/setup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account & continue" }).click();

  await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
});

test("the account lands in the wizard, not on an empty dashboard", async ({ page }) => {
  test.skip(!(await isFirstRun(page)), "instance is already set up");

  await page.goto("/setup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account & continue" }).click();

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("Step 2 of 5")).toBeVisible();

  // The wizard walk-through below needs the account, so hand off rather than
  // finishing here.
  await skipOnboardingIfShown(page);
  await expect(page.getByText(`Hi ${FIRST_NAME}`)).toBeVisible();
});

test("setup closes once an account exists", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);
});

test("the wizard does not reopen once it has been finished", async ({ page }) => {
  // Sign in rather than run setup again: the account exists by now, so /setup
  // redirects and there is no form to fill. Inlined rather than using signIn(),
  // because that helper skips the wizard when it appears — which is the very
  // thing this test has to observe.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Landing anywhere signed-in will do; where exactly is what this test asks.
  await page.waitForURL(/\/(welcome)?$/);

  // Skipping counts as finishing: the shell must stop redirecting, and /welcome
  // itself must send you on rather than starting over.
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
});
