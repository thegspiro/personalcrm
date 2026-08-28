import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * The first-run wizard, walked rather than skipped.
 *
 * The suite's shared account has already been through it by the time these run,
 * so rather than depending on a pristine instance these register a throwaway
 * account of their own and walk that one. That also keeps the walk-through from
 * leaving preferences on the account every other spec uses.
 *
 * Skipped when the instance has signups disabled, since there is then no way to
 * get a second account.
 */
const throwaway = () => ({
  name: "Wizard Walker",
  email: `wizard+${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  password: "correct-horse-9-battery",
});

async function register(page: import("@playwright/test").Page) {
  const account = throwaway();
  await page.goto("/signup");
  if (!page.url().endsWith("/signup")) return null; // signups are disabled

  await page.getByLabel("Your name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/welcome$/);
  return account;
}

test("the service worker is active before the install step", async ({ browser }, testInfo) => {
  // Use a context with no registrations inherited from another test. The
  // worker must be registered by the onboarding shell itself, not incidentally
  // by visiting the authenticated app shell first.
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();

  try {
    const account = await register(page);
    test.skip(account === null, "signups are disabled on this instance");

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByText("Step 2 of 5")).toBeVisible();
    await expect(page.getByText("Step 5 of 5")).toHaveCount(0);

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return registration?.active?.state;
          }),
        { timeout: 15_000 },
      )
      .toBe("activated");
  } finally {
    await context.close();
  }
});

test("the wizard walks through every step and lands on the dashboard", async ({ page }) => {
  // Make sure the instance is past first-run, so /signup is the route in.
  await ensureSignedIn(page);
  await page.context().clearCookies();

  const account = await register(page);
  test.skip(account === null, "signups are disabled on this instance");

  // Step 2 — about you.
  await expect(page.getByText("Step 2 of 5")).toBeVisible();
  await page.getByLabel("Your name").fill("Wizard Walker");
  await page.getByLabel("Weeks start on").selectOption("1");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — preferences.
  await expect(page.getByText("Step 3 of 5")).toBeVisible();
  await page.getByLabel("Remind me to reach out").selectOption("30");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4 — the first people. The button stays disabled until one is named.
  await expect(page.getByText("Step 4 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add someone to continue" })).toBeDisabled();
  await page.getByLabel("First name 1").fill("Wilhelmina");
  await page.getByRole("button", { name: "Add and continue" }).click();

  // Step 5 — install. No browser in CI can actually install, so the step's job
  // here is just to be reachable and to let you finish.
  await expect(page.getByText("Step 5 of 5")).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await page.waitForURL("/");
  await expect(page.getByText("Hi Wizard")).toBeVisible();

  // The person added in the wizard is really there.
  await page.goto("/people");
  await expect(page.getByText("Wilhelmina")).toBeVisible();
});

test("the dashboard checklist reflects what is actually done", async ({ page }) => {
  await ensureSignedIn(page);
  await page.context().clearCookies();

  const account = await register(page);
  test.skip(account === null, "signups are disabled on this instance");

  // Skip straight out — an account with nothing in it should be told what to do.
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL("/");

  const checklist = page.getByText("Finish setting up");
  await expect(checklist).toBeVisible();
  // Scoped to the checklist row: the dashboard's own quick actions carry a link
  // of the same name, so an unscoped locator matches two things and fails on
  // strict mode rather than on anything being wrong.
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "you want to keep in touch with" })
      .getByRole("link", { name: "Add someone" }),
  ).toBeVisible();
});
