import { expect, test } from "@playwright/test";
import { ACCOUNT, ensureSignedIn } from "./helpers";

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
  await expect(page.getByText(/This device/)).toBeVisible();
});
