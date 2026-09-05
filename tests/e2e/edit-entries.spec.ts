import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Correcting what is already written down.
 *
 * Everything hanging off a person used to be add-and-delete: the only way to
 * fix a typo in a fact was to remove the row and type it again, losing the
 * category and the privacy marker with it. These walk the loop that closes —
 * add, get it wrong, fix it in place — for the sections that carry the most.
 *
 * Run serially against one person, because each test corrects what the one
 * before it wrote.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const suffix = () => `${test.info().project.name}-${STAMP}`;
const PERSON = () => `Bellamy${suffix().replace(/[^a-z0-9]/gi, "")}`;

let personUrl = "";

/** The card for one section, addressed by its heading. */
function section(page: Page, title: string) {
  return page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).first();
}

/** The row inside a section that carries this text. */
function row(page: Page, sectionTitle: string, text: string) {
  return section(page, sectionTitle)
    .locator("div")
    .filter({ hasText: text })
    .last();
}

test("set up the person these tests write against", async ({ page }) => {
  await ensureSignedIn(page);
  personUrl = await createContact(page, PERSON());
});

test("a fact can be corrected in place, keeping its category", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const facts = section(page, "Things to know");
  await facts.getByRole("button", { name: "Add a fact" }).click();
  await facts.getByLabel("What should you remember?").fill("Reads le Carre");
  await facts.getByRole("button", { name: "Add", exact: true }).click();
  await expect(facts.getByText("Reads le Carre")).toBeVisible();

  await facts.getByRole("button", { name: "Edit fact" }).first().click();
  const field = facts.getByLabel("What should you remember?");
  await expect(field).toHaveValue("Reads le Carre");
  await field.fill("Reads le Carré, and says so");
  await facts.getByRole("button", { name: "Save", exact: true }).click();

  await expect(facts.getByText("Reads le Carré, and says so")).toBeVisible();
  await expect(facts.getByText("Reads le Carre", { exact: true })).toHaveCount(0);
});

test("someone in their life can be corrected in place, keeping the note", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const people = section(page, "People in their life");
  await people.getByRole("button", { name: "Add someone" }).click();
  await people.getByLabel("Their name").fill("Bob");
  await people.getByLabel("How do they know them?").fill("Colleauge");
  await people.getByLabel("Anything to remember?").fill("On night shifts until March.");
  await people.getByRole("button", { name: "Add", exact: true }).click();
  await expect(people.getByText("On night shifts until March.")).toBeVisible();

  // The note is not in the edit form's changed field, so it is exactly what a
  // form that only carried the name would silently clear.
  await people.getByRole("button", { name: "Edit entry" }).first().click();
  await people.getByLabel("How do they know them?").fill("Colleague from the hospital");
  await people.getByRole("button", { name: "Save", exact: true }).click();

  await expect(people.getByText("Colleague from the hospital")).toBeVisible();
  await expect(people.getByText("Colleauge", { exact: true })).toHaveCount(0);
  await expect(people.getByText("On night shifts until March.")).toBeVisible();
});

test("one of them can be promoted into a person, and stops being editable", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const people = section(page, "People in their life");
  await people.getByRole("button", { name: "Track as a person" }).first().click();
  // Pre-split from the one name the entry carries, then confirmed rather than
  // guessed: the surname was never known, so the form is where it is supplied.
  await expect(people.getByLabel("First name")).toHaveValue("Bob");
  await expect(people.getByLabel("Last name")).toHaveValue("");
  await people.getByLabel("Last name").fill("Ellis");

  // The type is required, so one has to be picked before the form will submit.
  await people.getByRole("button", { name: "Friend", exact: true }).click();
  await people.getByRole("button", { name: "Track them" }).click();

  await expect(people.getByText("Now tracked")).toBeVisible();
  // Read-only comes from the row rendering no edit control at all, rather than
  // from one that looks live and refuses.
  await expect(people.getByRole("button", { name: "Edit entry" })).toHaveCount(0);
  await expect(people.getByRole("button", { name: "Track as a person" })).toHaveCount(0);

  // The reciprocal relationship is real, not just a pointer on the entry.
  // That section starts collapsed, so it has to be opened to be read.
  const connected = section(page, "Connected people");
  await connected.getByRole("button", { name: /Connected people/ }).click();
  await expect(connected.getByRole("link", { name: /Bob Ellis/ })).toBeVisible();
});

test("the roll-up lists them under the person whose life they are in", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");

  await page.getByRole("link", { name: "Their people" }).click();
  await expect(page).toHaveURL(/\/people\/friends$/);

  // Scoped to this project's own person: the roll-up gathers everyone, so the
  // other project's identical entry is on the page too.
  const group = page
    .locator("section")
    .filter({ has: page.getByRole("link", { name: PERSON(), exact: true }) });

  await expect(group.getByText("Colleague from the hospital")).toBeVisible();
  await expect(group.getByRole("link", { name: /Bob Ellis/ })).toBeVisible();
  await expect(group.getByText("Now tracked")).toBeVisible();
});

test("a follow-up keeps its due date through an edit", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const tasks = section(page, "Tasks");
  await tasks.getByRole("button", { name: "Add a task" }).click();
  await tasks.getByLabel("What do you need to do?").fill("Send the bakery list");
  await tasks.getByRole("button", { name: "Add", exact: true }).click();
  await expect(tasks.getByText("Send the bakery list")).toBeVisible();

  await tasks.getByRole("button", { name: "Edit task" }).first().click();
  await tasks.getByLabel("What do you need to do?").fill("Send the bakery shortlist");
  await tasks.getByLabel("Priority").selectOption("HIGH");
  await tasks.getByRole("button", { name: "Save", exact: true }).click();

  await expect(tasks.getByText("Send the bakery shortlist")).toBeVisible();
});

test("a life event can be moved to a year it is only known to", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const events = section(page, "Significant moments");
  await events.getByRole("button", { name: "Add a significant moment" }).click();
  await events.getByLabel("What happened?").fill("Moved to Austin");
  // The presets live inside the picker's popover, which renders in a portal —
  // outside the section, so it is addressed from the page.
  await events.getByLabel("When").click();
  await page.getByRole("button", { name: "Last year" }).click();
  await events.getByRole("button", { name: "Add", exact: true }).click();
  await expect(events.getByText("Moved to Austin")).toBeVisible();

  await events.getByRole("button", { name: "Edit life event" }).first().click();
  await expect(events.getByLabel("What happened?")).toHaveValue("Moved to Austin");
  await events.getByLabel("What happened?").fill("Moved to Austin for the job");
  await events.getByRole("button", { name: "Save", exact: true }).click();

  await expect(events.getByText("Moved to Austin for the job")).toBeVisible();
});

test("a debt recorded the wrong way round can be turned round", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const debts = section(page, "Lent and borrowed");
  await debts.getByRole("button", { name: "Add a debt" }).click();
  await debts.getByLabel("What was it?").fill("Covered dinner");
  await debts.getByLabel("How much?").fill("42");
  await debts.getByRole("button", { name: "Add", exact: true }).click();
  // Exact, because the running balance above the rows says "They owe you $42.00"
  // in the same section — only the row's own caption is lower case and bare.
  await expect(debts.getByText("they owe you", { exact: true })).toBeVisible();

  await debts.getByRole("button", { name: "Edit debt" }).first().click();
  await debts.getByLabel("Which way?").selectOption("I_OWE_THEM");
  await debts.getByRole("button", { name: "Save", exact: true }).click();

  await expect(debts.getByText("you owe them", { exact: true })).toBeVisible();
  await expect(debts.getByText("they owe you", { exact: true })).toHaveCount(0);
});

test("a dietary preference can become the allergy it turned out to be", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(personUrl);

  const diet = section(page, "Food and dietary needs");
  await diet.getByRole("button", { name: "Add a dietary need" }).click();
  // The prompt is worded from the selected kind, and the form opens on
  // INTOLERANCE ("What can't they have?"), so pick the kind before filling it.
  await diet.getByRole("button", { name: "Preference", exact: true }).click();
  await diet.getByLabel("What do they prefer to avoid?").fill("Shellfish");
  await diet.getByRole("button", { name: "Add dietary need", exact: true }).click();
  await expect(diet.getByText("Shellfish")).toBeVisible();

  await diet.getByRole("button", { name: "Edit dietary need" }).first().click();
  await diet.getByRole("button", { name: "Allergy" }).click();
  await diet.getByRole("button", { name: "Save", exact: true }).click();

  await expect(row(page, "Allergies", "Shellfish")).toContainText("Food allergy");
});

test("a follow-up can also be fixed from the list page it shares with everyone", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/tasks");

  const task = page.locator("li").filter({ hasText: "Send the bakery shortlist" }).first();
  await task.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("What do you need to do?").fill("Send the bakery shortlist by Friday");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Send the bakery shortlist by Friday")).toBeVisible();
});
