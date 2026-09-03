import { expect, test } from "@playwright/test";
import { ACCOUNT, ensureSignedIn } from "./helpers";

const ROTATED_PASSWORD = "temporary-8-rotation-check";

test("account settings update a display name and protect email changes", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();

  await expect(
    page.getByRole("heading", { name: "Signed-in devices" }),
  ).toBeVisible();
  await expect(page.getByText("Session tokens are never shown.")).toBeVisible();
  await expect(
    page.getByText(
      /trusted mail channel or an explicit administrator-assisted mechanism/,
    ),
  ).toBeVisible();

  await page.getByLabel("Display name").fill(ACCOUNT.name);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Display name updated")).toBeVisible();

  await page.getByLabel("Email").fill("must-not-change@example.com");
  await page
    .getByLabel("Current password", { exact: true })
    .first()
    .fill("incorrect-password");
  await page.getByRole("button", { name: "Change email" }).click();
  await expect(page.getByText("Current password is incorrect.")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Account" }).click();
  await expect(page.getByLabel("Email")).toHaveValue(ACCOUNT.email);
  // Scoped to the device list, and matched with its separator: the password
  // section also says "This device stays signed in", and a bare match on the
  // phrase resolves to both.
  await expect(
    page
      .locator("section")
      .filter({ hasText: "Signed-in devices" })
      .getByText(/· This device/),
  ).toBeVisible();
});

test("a password change re-keys this session without signing this device out", async ({
  page,
}) => {
  // The server replaces the surviving session's token and sets the new cookie
  // on the same response. Getting that wrong logs the owner out of their own
  // account the moment they change their password, and nothing below the
  // action would notice: the row is correct either way.
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();

  const change = async (from: string, to: string) => {
    await page.getByLabel("Current password", { exact: true }).nth(1).fill(from);
    // Exact: "Confirm new password" contains this label as a substring.
    await page.getByLabel("New password", { exact: true }).fill(to);
    await page.getByLabel("Confirm new password").fill(to);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible();
  };

  try {
    await change(ACCOUNT.password, ROTATED_PASSWORD);
    // Still this account, on a route that redirects to /login without a
    // session that resolves.
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("tab", { name: "Account" }).click();
    await expect(page.getByLabel("Email")).toHaveValue(ACCOUNT.email);
  } finally {
    // Restored whatever happened above, because the whole suite signs in with
    // it and a failure here must not take the rest of the run with it.
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Account" }).click();
    await change(ROTATED_PASSWORD, ACCOUNT.password);
  }
});
