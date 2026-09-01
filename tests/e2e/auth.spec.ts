import { expect, test } from "@playwright/test";
import { ACCOUNT, FIRST_NAME, ensureSignedIn, signOut } from "./helpers";

test("a signed-out visitor is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the wrong password is rejected", async ({ page }) => {
  await ensureSignedIn(page);
  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill("definitely-the-wrong-one");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/don't match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("an unknown email gets the same message as a wrong password", async ({ page }) => {
  await ensureSignedIn(page);
  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody-at-all@example.com");
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/don't match/i)).toBeVisible();
});

test("repeated wrong guesses are throttled", async ({ page }) => {
  // Deliberately an address no other test signs in as: throttling is keyed on
  // the address, and locking out the shared account would break every test
  // that runs after this one.
  const email = "guessed-at@example.com";

  await page.goto("/login");

  // Kept as a loop with a break rather than a fixed sixth attempt. The first
  // wait is only five seconds long and it runs from the last attempt, so on a
  // slow runner it can lapse before the next submission lands. Each further
  // failure doubles it, so looping converges instead of racing the clock.
  let throttled = false;
  for (let attempt = 0; attempt < 10 && !throttled; attempt += 1) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`wrong-${attempt}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/don't match|Too many sign-in attempts/i)).toBeVisible();
    throttled = await page.getByText(/Too many sign-in attempts/i).isVisible();
  }

  expect(throttled).toBe(true);
  // The refusal says how long to wait, never whether the address exists.
  await expect(page.getByText(/don't match/i)).toHaveCount(0);
});

test("signing in lands on the dashboard and signing out ends the session", async ({ page }) => {
  await ensureSignedIn(page);
  await expect(page.getByText(`Hi ${FIRST_NAME}`)).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);

  // Confirm the cookie is actually gone, not just that we navigated away.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the primary navigation is present", async ({ page }) => {
  await ensureSignedIn(page);

  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav).toBeVisible();
  for (const label of ["Home", "People", "Timeline", "Dating"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});

test("the health endpoint reports the database is reachable", async ({ page }) => {
  const response = await page.request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", database: "up" });
});
