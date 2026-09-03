import { expect, test, type Page } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Family: recording relatives, inferring the ones you haven't recorded, and
 * ending a relationship without losing the person.
 */
test.describe.configure({ mode: "serial" });

/** Unique per run and project — the suite runs against instances with data. */
const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const suffix = () => `${test.info().project.name}-${STAMP}`;

const PARENT = () => `Wren ${suffix()}`;
const SIBLING = () => `Idris ${suffix()}`;
const NIECE = () => `Juno ${suffix()}`;
const PARTNER = () => `Sasha ${suffix()}`;

async function addPerson(page: Page, name: string) {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(name);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

async function openPerson(page: Page, name: string) {
  await page.goto(`/people?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

/** The Family card, identified by its add button rather than its title. */
function familyCard(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add a relative" }) });
}

async function linkRelative(page: Page, subject: string, other: string, type: string) {
  await openPerson(page, subject);
  const card = familyCard(page);
  await card.getByRole("button", { name: "Add a relative" }).click();
  // The picker shows a short recent list until you search, by design.
  await card.getByLabel("Search people").fill(other);
  await card.getByRole("button", { name: new RegExp(other) }).click();
  await card.getByLabel("Is their…").selectOption({ label: type });
  await card.getByRole("button", { name: "Link", exact: true }).click();
  await expect(card.getByText(type, { exact: true })).toBeVisible();
}

test("record a family, and see it grouped by tier", async ({ page }) => {
  await ensureSignedIn(page);
  for (const name of [PARENT(), SIBLING(), NIECE(), PARTNER()]) {
    await addPerson(page, name);
  }

  await linkRelative(page, SIBLING(), PARENT(), "Parent");
  await linkRelative(page, NIECE(), SIBLING(), "Parent");
  await linkRelative(page, SIBLING(), PARTNER(), "Spouse");

  await openPerson(page, SIBLING());
  const card = familyCard(page);
  await expect(card.getByText("Immediate family")).toBeVisible();
  await expect(card.getByRole("link", { name: new RegExp(PARENT()) })).toBeVisible();
  await expect(card.getByRole("link", { name: new RegExp(NIECE()) })).toBeVisible();
});

test("suggests the relatives you did not record, with its reasoning", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, PARENT());

  const suggestions = page
    .locator("section")
    .filter({ hasText: "Possible relatives" })
    .first();
  // Wren's child Idris has a child of their own, so Juno is a grandchild.
  await expect(suggestions.getByRole("link", { name: NIECE() })).toBeVisible();
  await expect(suggestions.getByText(/maybe their grandchild/)).toBeVisible();
  await expect(suggestions.getByText(/is their child/).first()).toBeVisible();

  // Nothing is written until it is accepted.
  const card = familyCard(page);
  await expect(card.getByRole("link", { name: new RegExp(NIECE()) })).toHaveCount(0);
});

test("accepting a suggestion records it in both directions", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, PARENT());

  const suggestions = page.locator("section").filter({ hasText: "Possible relatives" }).first();
  await suggestions.getByRole("button", { name: `Add ${NIECE()}`, exact: true }).click();
  await suggestions.getByRole("button", { name: `Add ${NIECE()}` }).last().click();

  await expect(familyCard(page).getByRole("link", { name: new RegExp(NIECE()) })).toBeVisible();

  // The reciprocal is written too, so it reads correctly from the other side.
  await openPerson(page, NIECE());
  await expect(familyCard(page).getByRole("link", { name: new RegExp(PARENT()) })).toBeVisible();
});

test("a marriage can end without losing the person", async ({ page }) => {
  await ensureSignedIn(page);
  await openPerson(page, SIBLING());

  const card = familyCard(page);
  await card.getByRole("button", { name: `Spouse with ${PARTNER()} has ended` }).click();
  await card.getByLabel("Note (optional)").fill("Divorced, still friendly.");
  await card.getByRole("button", { name: "Mark as ended" }).click();

  await expect(card.getByText("Former family")).toBeVisible();
  await expect(card.getByText("Ex-spouse")).toBeVisible();
  await expect(card.getByText("Divorced, still friendly.")).toBeVisible();
  // The person is still there, and still linked.
  await expect(card.getByRole("link", { name: new RegExp(PARTNER()) })).toBeVisible();

  // Blood relations offer no such control.
  await openPerson(page, NIECE());
  await expect(familyCard(page).getByRole("button", { name: /has ended$/ })).toHaveCount(0);
});

test("the family page bands people by generation", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/family");

  await expect(page.getByRole("heading", { name: "Family", level: 2 })).toBeVisible();
  await page.getByLabel("Measure generations from").selectOption({ label: SIBLING() });
  await page.waitForURL(/\/family\?anchor=/);

  await expect(page.getByText(/parents' generation/i).first()).toBeVisible();
  await expect(page.getByText("Measured from here")).toBeVisible();
});

test("households group people explicitly", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/family");

  const households = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "New household" }) });
  await households.getByRole("button", { name: "New household" }).click();

  const name = `House ${suffix()}`;
  await households.getByLabel("Name").fill(name);
  for (const member of [SIBLING(), PARTNER()]) {
    await households.getByLabel("Search people").fill(member);
    await households.getByRole("button", { name: new RegExp(member) }).click();
  }
  await households.getByRole("button", { name: "Create" }).click();

  await expect(households.getByRole("heading", { name })).toBeVisible();

  // It shows up on the member's own page too.
  await openPerson(page, SIBLING());
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add to a household" }) });
  await expect(card.getByText(name)).toBeVisible();
});

test("a household can be renamed without losing anyone in it", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/family");

  const households = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "New household" }) });
  const name = `House ${suffix()}`;
  const renamed = `${name} upstairs`;

  await households.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await households.getByLabel("Name", { exact: true }).fill(renamed);
  // Stamped, because both projects run against the same instance and the
  // desktop pass would otherwise match the note the mobile pass left behind.
  const note = `Sunday lunches, ${suffix()}.`;
  await households.getByLabel("Notes (optional)").fill(note);
  await households.getByRole("button", { name: "Save" }).click();

  await expect(households.getByRole("heading", { name: renamed })).toBeVisible();
  await expect(households.getByText(note)).toBeVisible();
  // Renaming the group is not a change to who is in it.
  await expect(households.getByRole("link", { name: new RegExp(SIBLING()) })).toBeVisible();
  await expect(households.getByRole("link", { name: new RegExp(PARTNER()) })).toBeVisible();
});

test("two people can be linked from the family page itself", async ({ page }) => {
  await ensureSignedIn(page);
  const cousin = `Rui ${suffix()}`;
  await addPerson(page, cousin);

  await page.goto("/family");
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Link two people" }) });
  await card.getByRole("button", { name: "Link two people" }).click();

  const whose = card.getByRole("group", { name: "Whose relative", exact: true });
  await whose.getByLabel("Search people").fill(PARENT());
  await whose.getByRole("button", { name: new RegExp(PARENT()) }).click();

  await card.getByLabel("They are this person's…").selectOption({ label: "Cousin" });

  const who = card.getByRole("group", { name: "Who", exact: true });
  await who.getByLabel("Search people").fill(cousin);
  await who.getByRole("button", { name: new RegExp(cousin) }).click();

  await card.getByRole("button", { name: "Link", exact: true }).click();

  // Written through the same action the contact page uses, so both halves land.
  await openPerson(page, PARENT());
  await expect(familyCard(page).getByRole("link", { name: new RegExp(cousin) })).toBeVisible();
  await openPerson(page, cousin);
  await expect(familyCard(page).getByRole("link", { name: new RegExp(PARENT()) })).toBeVisible();
});
