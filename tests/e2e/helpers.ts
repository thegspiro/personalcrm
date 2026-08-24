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

/** Sign in, running first-run setup first if this instance is brand new. */
export async function ensureSignedIn(page: Page): Promise<void> {
  if (await isFirstRun(page)) {
    await completeSetup(page);
    return;
  }
  await signIn(page);
}
