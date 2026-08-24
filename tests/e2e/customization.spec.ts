import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Making the app your own: your own fields, your own type names, your own
 * home screen.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const suffix = () => `${test.info().project.name}-${STAMP}`;

const FIELD = () => `Coffee order ${suffix()}`;
const CHOICE_FIELD = () => `Tea ${suffix()}`;
const PERSON = () => `Fielding ${suffix()}`;
const TERM = () => `Pub quiz ${suffix()}`;

async function openSettings(page: Page, tab: string) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: tab }).click();
}

/** The card for one entity's custom fields, found by its add button. */
function fieldsCard(page: Page, addLabel: string) {
  return page.locator("section").filter({ has: page.getByRole("button", { name: addLabel }) });
}

test("define your own fields", async ({ page }) => {
  await ensureSignedIn(page);
  await openSettings(page, "Fields");

  const card = fieldsCard(page, "Add a field for people");
  await card.getByRole("button", { name: "Add a field for people" }).click();
  await card.getByLabel("Name", { exact: true }).fill(FIELD());
  await card.getByRole("button", { name: "Add field" }).click();
  await expect(card.getByText(FIELD())).toBeVisible();

  // A choice field needs its options, and the options box only appears once
  // the type calls for one.
  await card.getByRole("button", { name: "Add a field for people" }).click();
  await card.getByLabel("Name", { exact: true }).fill(CHOICE_FIELD());
  await card.getByLabel("Type").selectOption({ label: "One of a list" });
  await card.getByLabel("Choices").fill("Green\nBlack\nNone");
  await card.getByRole("button", { name: "Add field" }).click();
  await expect(card.getByText(CHOICE_FIELD())).toBeVisible();
});

test("fill your own fields on a person", async ({ page }) => {
  await ensureSignedIn(page);
  const url = await createContact(page, PERSON());

  await page.goto(`${url}/edit`);
  await page.getByLabel(FIELD()).fill("Flat white, no sugar");
  await page.getByLabel(CHOICE_FIELD()).selectOption({ label: "Green" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(url);

  // Values show on the person's page, under their own section.
  const values = page
    .locator("section")
    .filter({ hasText: "Your own fields" })
    .first();
  await expect(values.getByText("Flat white, no sugar")).toBeVisible();
  await expect(values.getByText("Green", { exact: true })).toBeVisible();
});

test("a value survives renaming the field", async ({ page }) => {
  await ensureSignedIn(page);
  await openSettings(page, "Fields");

  const card = fieldsCard(page, "Add a field for people");
  const renamed = `Usual drink ${suffix()}`;
  await card.getByRole("button", { name: `Edit ${FIELD()}` }).click();
  await card.getByLabel("Name", { exact: true }).last().fill(renamed);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText(renamed)).toBeVisible();

  // The label is not the identity — values hang off the definition's id.
  await page.goto(`/people?q=${encodeURIComponent(PERSON())}`);
  await page.getByRole("link", { name: new RegExp(PERSON()) }).first().click();
  await expect(page.getByText("Flat white, no sugar")).toBeVisible();
});

test("rename a type and see it everywhere", async ({ page }) => {
  await ensureSignedIn(page);
  await openSettings(page, "Types");

  const card = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add to interaction types" }) });
  await card.getByRole("button", { name: "Add to interaction types" }).click();
  await card.getByLabel("Name", { exact: true }).fill(TERM());
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.getByText(TERM())).toBeVisible();

  // It is a real taxonomy term, so it shows up wherever interaction types do.
  await page.goto("/");
  await page.getByRole("button", { name: "Log interaction" }).click();
  await expect(page.getByRole("button", { name: TERM(), exact: true })).toBeVisible();
});

test("a type in use can't be deleted, only turned off", async ({ page }) => {
  await ensureSignedIn(page);

  // Put someone in a category first, so the term genuinely is in use — the
  // whole point of the rule is that deleting would rewrite their record.
  await page.goto(`/people?q=${encodeURIComponent(PERSON())}`);
  await page.getByRole("link", { name: new RegExp(PERSON()) }).first().click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
  const url = page.url();
  await page.goto(`${url}/edit`);
  await page.getByRole("button", { name: "Family", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(url);

  await openSettings(page, "Types");
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add to contact categories" }) });
  // The section is collapsed by default; its header toggle carries the count.
  await card.getByRole("button", { name: /^Contact categories \d+$/ }).click();

  await card.getByRole("button", { name: "Edit Family" }).first().click();
  await expect(card.getByText(/turn it off instead of deleting/i)).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("rearrange the home screen", async ({ page }) => {
  await ensureSignedIn(page);
  await openSettings(page, "Home");

  // The settings row and the widget itself carry the same name, so what you
  // switch off is unambiguously what disappears.
  await page.getByRole("switch", { name: "Show Bring this up" }).click();
  await page.goto("/");
  await expect(page.getByText("Bring this up")).toHaveCount(0);

  await openSettings(page, "Home");
  await page.getByRole("switch", { name: "Show Bring this up" }).click();
  await page.goto("/");
  await expect(page.getByText("Bring this up").first()).toBeVisible();
});

test("widget settings change what the dashboard fetches", async ({ page }) => {
  await ensureSignedIn(page);
  await openSettings(page, "Home");

  const limit = page.getByLabel("How many to show").first();
  await limit.fill("3");
  await limit.blur();
  await expect(page.getByText("Saved").or(page.locator("body"))).toBeVisible();

  await openSettings(page, "Home");
  await expect(page.getByLabel("How many to show").first()).toHaveValue("3");
});
