import { expect, test, type Browser } from "@playwright/test";
import { ACCOUNT, ensureSignedIn } from "./helpers";
import { totpCode } from "../../src/server/crypto/totp";

/**
 * Two-factor sign-in, end to end.
 *
 * Every test after the first starts from a fresh browser context and therefore
 * signed out, so each one drives `/login` itself. `ensureSignedIn` must not be
 * used once the factor is on: it falls back to creating an account when the
 * password does not land on the dashboard within five seconds, which is exactly
 * what the second step now does.
 *
 * The assertion that matters is the negative one: once this is on, the password
 * alone must not produce a session. Everything else here exists to set that up
 * and to put the account back afterwards, since the projects share one account.
 */
test.describe.configure({ mode: "serial" });

let secret = "";
let recoveryCodes: string[] = [];

/** The step a code was last accepted for, so the next one is never a replay. */
let spentStep = -1;

/**
 * A code from a step this run has not already spent.
 *
 * The replay guard refuses a code whose step has been used, which is correct —
 * a code stays valid for its whole 30 seconds, and one seen over a shoulder
 * must not still work. But this spec signs in several times inside a single
 * step, which no person would, so it waits for the clock to roll rather than
 * weakening the guard to suit the test. A condition, not a fixed sleep: it
 * returns the moment the step changes.
 */
async function freshCode(page: import("@playwright/test").Page): Promise<string> {
  const step = () => Math.floor(Date.now() / 1000 / 30);
  while (step() === spentStep) {
    await page.waitForTimeout(500);
  }
  spentStep = step();
  return totpCode(secret);
}

async function openTwoFactor(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
}

test("enrolling shows a key and then the recovery codes", async ({ page }) => {
  await ensureSignedIn(page);
  await openTwoFactor(page);

  await page.getByLabel("Confirm your password to begin").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Set up" }).click();

  // The key is shown for manual entry — there is no QR code, deliberately.
  const shown = page.locator("p.font-mono").first();
  await expect(shown).toBeVisible();
  secret = (await shown.innerText()).replace(/\s/g, "");
  expect(secret.length).toBeGreaterThan(20);

  // Nothing gates a sign-in yet: the authenticator has not been proved.
  await page.getByLabel("2. Enter the code it shows").fill(await freshCode(page));
  await page.getByRole("button", { name: "Turn on" }).click();

  await expect(page.getByText("Your recovery codes")).toBeVisible();
  const codes = await page.locator("ul.font-mono li").allInnerTexts();
  recoveryCodes = codes.map((code) => code.trim()).filter(Boolean);
  expect(recoveryCodes).toHaveLength(10);
});

test("the password alone no longer signs you in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Stopped at the second step, not on the dashboard.
  await expect(page).toHaveURL(/\/login\/verify$/);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

  // And the session really does not exist yet: a guarded page still redirects.
  const guarded = await page.request.get("/people", { maxRedirects: 0 });
  expect(guarded.status(), "a guarded route must still redirect").toBeGreaterThanOrEqual(300);
  expect(guarded.status()).toBeLessThan(400);
});

test("a wrong code is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);

  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
  await expect(page).toHaveURL(/\/login\/verify$/);
});

test("the right code completes the sign-in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);

  await page.getByLabel("Code").fill(await freshCode(page));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("a recovery code works in place of the app, once", async ({ page }) => {
  const code = recoveryCodes[0]!;

  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // Spent: the same one must not work a second time.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
});

test("turning it off restores password-only sign-in", async ({ page }) => {
  // Put the shared account back, or every later project signs in against a
  // factor it has no secret for.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(await freshCode(page));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible();

  await openTwoFactor(page);
  await page.getByLabel("Turn two-factor off").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByLabel("Confirm your password to begin")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

/**
 * Put the shared account back even if a test above failed.
 *
 * The last test turns the factor off as part of what it asserts, but a failure
 * before it would leave the account needing a code — and every later spec signs
 * in through `ensureSignedIn`, which cannot supply one and creates an account
 * instead. One failure here would read as a dozen unrelated ones.
 */
test.afterAll(async ({ browser }: { browser: Browser }) => {
  if (!secret) return;

  const page = await browser.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Already off: the last test got there, and this has nothing to do.
    if (!/\/login\/verify$/.test(page.url())) return;

    await page.getByLabel("Code").fill(await freshCode(page));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Account" }).click();
    await page.getByLabel("Turn two-factor off").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByLabel("Confirm your password to begin").waitFor();
  } catch {
    // Best effort. A failure here must not mask the failure that caused it.
  } finally {
    await page.close();
  }
});
