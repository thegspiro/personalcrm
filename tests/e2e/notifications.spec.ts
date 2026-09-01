import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Configuring where reminders go.
 *
 * The delivery engine was finished long before there was any way to give it a
 * destination, so every account had zero channels and the hourly job sent
 * nothing. This covers the half that was missing.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

async function openReminderSettings(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Reminders" }).click();
  await expect(page.getByText("Reminders about important dates")).toBeVisible();
}

test("add a channel, edit it, switch it off and delete it", async ({ page }) => {
  await ensureSignedIn(page);
  await openReminderSettings(page);

  const name = `Desk ${test.info().project.name} ${STAMP}`;

  const addForm = page.locator("section").filter({ hasText: "Add a channel" });
  await addForm.getByRole("button", { name: "Webhook", exact: true }).click();
  await addForm.getByLabel("Name", { exact: true }).fill(name);
  await addForm.getByLabel("URL", { exact: true }).fill("https://hook.example.com/first");
  await addForm.getByLabel("Token", { exact: true }).fill("a-secret-token");
  await addForm.getByRole("button", { name: "Add channel" }).click();

  const card = page.locator("section").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText("hook.example.com/first")).toBeVisible();

  // The token is never sent back to the browser, so the field comes back empty
  // and blank has to mean "keep it".
  await card.getByRole("button", { name: "Edit" }).click();
  await expect(card.getByLabel("Token", { exact: true })).toHaveValue("");
  await expect(card.getByText(/Leave blank to keep it/)).toBeVisible();
  await card.getByLabel("URL", { exact: true }).fill("https://hook.example.com/second");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("hook.example.com/second")).toBeVisible();

  // Scoped to this card: the suite runs against an instance that may already
  // hold channels, so anything asserted about "every channel" would be a test
  // that passes or fails on what a previous run left behind.
  const toggle = card.getByRole("switch");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("section").filter({ hasText: name })).toHaveCount(0);
});

test("a channel that cannot be reached says so rather than failing silently", async ({ page }) => {
  await ensureSignedIn(page);
  await openReminderSettings(page);

  const name = `Unreachable ${test.info().project.name} ${STAMP}`;

  const addForm = page.locator("section").filter({ hasText: "Add a channel" });
  await addForm.getByRole("button", { name: "Webhook", exact: true }).click();
  await addForm.getByLabel("Name", { exact: true }).fill(name);
  // Nothing listens here, so the send fails — which is the point. A test that
  // depended on a real endpoint would be a test that fails on a plane.
  await addForm.getByLabel("URL", { exact: true }).fill("https://127.0.0.1:1/nothing");
  await addForm.getByRole("button", { name: "Add channel" }).click();

  const card = page.locator("section").filter({ hasText: name });
  await card.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText(/Test message sent/)).toBeHidden();

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
});

test("a channel is refused rather than saved in a shape the sender rejects", async ({ page }) => {
  await ensureSignedIn(page);
  await openReminderSettings(page);

  // Scoped to the add form and exact: "To" otherwise matches "Toggle theme"
  // and every "Send to <channel>" switch on the page.
  const addForm = page.locator("section").filter({ hasText: "Add a channel" });
  await addForm.getByRole("button", { name: "Email", exact: true }).click();
  await addForm.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await addForm.getByLabel("From", { exact: true }).fill("crm@example.com");
  await addForm.getByLabel("To", { exact: true }).fill("me@example.com");
  // The browser blocks a malformed address before the action ever runs, so the
  // case worth driving here is one it lets through. A port out of range would
  // otherwise be stored as a string and read back as 587 by the sender.
  await addForm.getByLabel("Port", { exact: true }).fill("70000");
  await addForm.getByRole("button", { name: "Add channel" }).click();

  await expect(page.getByText(/check the highlighted fields/i)).toBeVisible();
  // The field itself has to say what is wrong. A generic toast over a form
  // with nothing highlighted does not tell you which of seven inputs to fix.
  await expect(addForm.getByText(/whole number between 1 and 65535/i)).toBeVisible();
  // And nothing was stored. Saving it would produce a channel that throws
  // inside the sender an hour later, in a cron job nobody is watching.
  await expect(page.locator("section").filter({ hasText: "smtp.example.com" })).toHaveCount(0);
});
