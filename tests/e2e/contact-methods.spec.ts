import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Recording how to reach someone, and where they live.
 *
 * Both tables shipped in the first migration and were loaded on every contact
 * page, but nothing could write to them — so this covers the whole round trip
 * rather than one action: that a number saves, that it becomes something you
 * can press, and that promoting a second method demotes the first.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

test("record a number and an email, and reach them from the page", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Reach ${test.info().project.name} ${STAMP}`;
  const url = await createContact(page, name);

  const methods = page.locator("section").filter({ hasText: "How to reach them" });
  await expect(methods.getByText("No phone number, email address or handle recorded.")).toBeVisible();

  await methods.getByRole("button", { name: "Add a way to reach them" }).click();
  await methods.getByRole("button", { name: "Mobile", exact: true }).click();
  await methods.getByLabel("Number, address or handle").fill("+1 (555) 010-4477");
  await methods.getByLabel("Label (optional)").fill("Work");
  await methods.getByRole("button", { name: "Add", exact: true }).click();

  // A number you cannot press is a number you retype into the dialer. Two
  // links, because the first method added is also the one the header shows.
  await expect(page.locator('a[href="tel:+15550104477"]')).toHaveCount(2);
  await expect(methods.getByText("Work")).toBeVisible();

  await methods.getByRole("button", { name: "Add a way to reach them" }).click();
  await methods.getByRole("button", { name: "Email", exact: true }).click();
  await methods.getByLabel("Number, address or handle").fill("reach@example.com");
  await methods.getByRole("button", { name: "Add", exact: true }).click();
  await expect(methods.locator('a[href="mailto:reach@example.com"]')).toBeVisible();

  // The first method added is the primary, and promoting the second moves it.
  // `exact` matters: "Make primary" contains the badge's text otherwise.
  const badge = methods.getByText("Primary", { exact: true });
  await expect(badge).toHaveCount(1);

  const emailRow = methods.locator("div.group").filter({ hasText: "reach@example.com" });
  await emailRow.getByRole("button", { name: "Make primary" }).click();

  await expect(badge).toHaveCount(1);
  await expect(emailRow.getByText("Primary", { exact: true })).toBeVisible();

  // Which is what the header shows, above the fold — the number that was
  // there a moment ago has handed the slot over.
  await page.goto(url);
  await expect(page.locator('a[href="mailto:reach@example.com"]')).toHaveCount(2);
  await expect(page.locator('a[href="tel:+15550104477"]')).toHaveCount(1);
});

test("record an address, and refuse one with nothing in it", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Where ${test.info().project.name} ${STAMP}`;
  await createContact(page, name);

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Label (optional)").fill("Home");
  await addresses.getByRole("button", { name: "Add", exact: true }).click();

  // A label alone would render as a row that is only a delete button.
  await expect(page.getByText("Fill in at least one line of the address.")).toBeVisible();

  await addresses.getByLabel("Address", { exact: true }).fill("14 Ashfield Road");
  await addresses.getByLabel("City").fill("Leeds");
  await addresses.getByRole("button", { name: "Add", exact: true }).click();

  await expect(addresses.getByText("14 Ashfield Road")).toBeVisible();
  await expect(addresses.getByText("Leeds")).toBeVisible();
});
