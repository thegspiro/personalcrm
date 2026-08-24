import { expect, test } from "@playwright/test";
import { ACCOUNT, FIRST_NAME, ensureSignedIn, signIn } from "./helpers";

test("a signed-out visitor is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill("definitely-the-wrong-one");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/don't match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("an unknown email gets the same message as a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody-at-all@example.com");
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/don't match/i)).toBeVisible();
});

test("signing in lands on the dashboard and signing out ends the session", async ({ page }) => {
  await signIn(page);
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
