import type { Page } from "@playwright/test";

/**
 * The account the suite uses. Created by first-run setup if the instance is
 * empty; otherwise assumed to already exist (see ensureAccount).
 */
export const ACCOUNT = {
  name: "Test Owner",
  email: `owner+${process.env.E2E_RUN_ID ?? "local"}@example.com`,
  password: "correct-horse-9-battery",
};

export const FIRST_NAME = ACCOUNT.name.split(" ")[0];

/** True when no account exists yet, i.e. /setup is still open. */
export async function isFirstRun(page: Page): Promise<boolean> {
  const response = await page.request.get("/setup", { maxRedirects: 0 });
  return response.status() === 200;
}

export async function completeSetup(page: Page): Promise<void> {
  await page.goto("/setup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account & start" }).click();
  await page.waitForURL("/");
}

export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

/** Register the suite's account through the signup form. */
export async function signUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/");
}

/**
 * Get to a signed-in state whatever the instance already contains: run
 * first-run setup on an empty one, sign in when the account exists, and
 * register when it doesn't. That lets the suite run against a fresh container
 * or an instance that already has data, without a manual reset.
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  if (await isFirstRun(page)) {
    await completeSetup(page);
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Either we land on the dashboard, or the credentials were rejected because
  // the account has not been created on this instance yet.
  const landed = await page
    .waitForURL("/", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (landed) return;

  await signUp(page);
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
}

/**
 * Create a contact and return the URL of its page.
 *
 * Waits on the rendered heading rather than a URL pattern: `/people/new`
 * matches an id-shaped path too, so a naive URL match resolves while still on
 * the form, before the contact has been saved at all.
 */
export async function createContact(page: Page, firstName: string): Promise<string> {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(firstName);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("heading", { name: firstName, level: 2 }).waitFor();
  return page.url();
}
