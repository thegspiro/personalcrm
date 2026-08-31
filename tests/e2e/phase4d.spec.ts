import { expect, test, type Page } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Dietary needs, debts, and who got in touch.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

function personName(): string {
  return `Phase4d ${test.info().project.name} ${STAMP}`;
}

function section(page: Page, title: string) {
  return page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).first();
}

async function openPerson(page: Page, name: string) {
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("create the person this spec works with", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(personName());
  await page.getByLabel("Last name").fill("Case");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: `${personName()} Case`, level: 2 })).toBeVisible();
});

test("an allergy and a preference are kept visibly apart", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  await page.getByRole("button", { name: "Add an allergy" }).click();
  await page.getByLabel("What food are they allergic to?").fill("Shellfish");
  await page.getByLabel("Carries adrenaline for this allergy").check();
  await page.getByRole("button", { name: "Add allergy", exact: true }).click();

  // The header summary chip and the allergy row both name the allergen, so
  // assert each precisely instead of letting one substring match resolve to both.
  await expect(page.getByRole("link", { name: "Allergies: Shellfish" })).toBeVisible();
  await expect(page.getByText("Shellfish", { exact: true })).toBeVisible();
  await expect(page.getByText("Carries adrenaline", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add a dietary need" }).click();
  await page.getByRole("button", { name: "Preference", exact: true }).click();
  await page.getByLabel("What do they prefer to avoid?").fill("Mushrooms");
  await page.getByRole("button", { name: "Add dietary need", exact: true }).click();

  // SectionCard renders its title as a span, so there is no heading role to
  // match. Locate each section by its title and assert what the test name
  // claims: the allergy and the preference are filed apart, not merely present.
  const allergies = section(page, "Allergies");
  const dietary = section(page, "Food and dietary needs");
  await expect(allergies.getByText("Shellfish", { exact: true })).toBeVisible();
  await expect(dietary.getByText("Mushrooms", { exact: true })).toBeVisible();
  await expect(allergies.getByText("Mushrooms", { exact: true })).toHaveCount(0);
  await expect(dietary.getByText("Shellfish", { exact: true })).toHaveCount(0);
});

test("offers no way to grade an allergy as mild", async ({ page }) => {
  // Prior mild reactions don't predict future severe ones, so the interface
  // must never invite a reassuring label.
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  await page.getByRole("button", { name: "Add an allergy" }).click();
  await expect(page.getByRole("button", { name: /^(mild|moderate|severe)$/i })).toHaveCount(0);
  await expect(page.getByLabel(/severity/i)).toHaveCount(0);
});

test("a lent thing is counted but never given a value", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  await page.getByRole("button", { name: "Add a debt" }).click();
  await page.getByLabel("What was it?").fill("Covered dinner");
  await page.getByLabel("How much?").fill("40");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("They owe you $40.00")).toBeVisible();

  await page.getByRole("button", { name: "Add a debt" }).click();
  await page.getByLabel("What was it?").fill("My cordless drill");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // The drill must not conjure a second balance line, and the money total is
  // unchanged by it.
  await expect(page.getByText("1 thing lent, no sum attached")).toBeVisible();
  await expect(page.getByText("They owe you $40.00")).toBeVisible();
  await expect(page.getByText("$0.00")).toHaveCount(0);
});

test("settling keeps the row instead of deleting it", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  // The section is collapsed until asked for — it is a ledger, not a headline.
  await page.getByRole("button", { name: /^Lent and borrowed/ }).click();
  await page.getByRole("button", { name: "Mark settled" }).first().click();
  await expect(page.getByRole("button", { name: /\d+ settled/ })).toBeVisible();

  await page.getByRole("button", { name: /\d+ settled/ }).click();
  await expect(page.getByText("Covered dinner")).toBeVisible();
});

test("who got in touch reaches the timeline", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  await page.getByRole("button", { name: "Log interaction" }).click();
  await expect(page.getByRole("heading", { name: "Log an interaction" })).toBeVisible();
  await page.getByRole("button", { name: "They did", exact: true }).click();
  await page.getByLabel("Title").fill("They called out of the blue");
  await page.getByRole("button", { name: "Log it" }).click();

  await expect(page.getByText("They called out of the blue")).toBeVisible();
  await expect(page.getByText("They got in touch").first()).toBeVisible();
});

test("says nothing conclusive from a single interaction", async ({ page }) => {
  // The day-one state. It must read as "nothing to say yet", never as 0%.
  await ensureSignedIn(page);
  await openPerson(page, `${personName()} Case`);

  await expect(page.getByText(/Not enough noted yet/)).toBeVisible();
  await expect(page.getByText("%")).toHaveCount(0);
});
