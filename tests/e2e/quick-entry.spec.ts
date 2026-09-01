import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Getting things in quickly: the palette, the floating log button, and quick
 * add.
 *
 * Everything here runs with no API key set, because that is the default
 * install and the local parser is the whole feature.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const suffix = () => `${test.info().project.name}-${STAMP}`;

const SOLO = () => `Quillon ${suffix()}`;

/**
 * Two people who genuinely share a first name — an uncle and a cousin both
 * called Hattie. The shared part is stamped so it is unique to this run while
 * still being identical between the two.
 */
const SHARED_FIRST = () => `Hattie${suffix().replace(/[^a-z0-9]/gi, "")}`;
const TWIN_A = () => `${SHARED_FIRST()} Whitfield`;
const TWIN_B = () => `${SHARED_FIRST()} Bell`;

/** The quick-add preview form, identified by the line it echoes back. */
function previewForm(page: Page) {
  return page.locator("form").filter({ hasText: "From " }).first();
}

/** Someone with both a first and a last name — createContact only sets first. */
async function createNamedContact(page: Page, firstName: string, lastName: string) {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill(lastName);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
}

async function quickAdd(page: Page, line: string) {
  await page.goto("/");
  await page.getByLabel("Describe what happened").fill(line);
  await page.getByRole("button", { name: "Read" }).click();
  await expect(previewForm(page)).toBeVisible();
}

test("set up people for the quick-entry tests", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, SOLO());
  // Two people whose first name is the same word — the case that must never
  // be guessed at.
  await createNamedContact(page, SHARED_FIRST(), "Whitfield");
  await createNamedContact(page, SHARED_FIRST(), "Bell");
});

test("quick add reads a line and only writes on confirm", async ({ page }) => {
  await ensureSignedIn(page);
  await quickAdd(page, `coffee with ${SOLO()} yesterday, good chat`);

  const form = previewForm(page);
  await expect(form.getByText(SOLO()).first()).toBeVisible();
  await expect(form.getByText(/read from "yesterday"/)).toBeVisible();
  await expect(form.getByLabel("Notes")).toHaveValue("good chat");

  // Nothing is written until Log it — abandoning the preview leaves no trace.
  await form.getByRole("button", { name: "Start over" }).click();
  await page.goto("/timeline");
  await expect(page.getByText("good chat")).toHaveCount(0);
});

test("confirming a quick add logs it against the right person", async ({ page }) => {
  await ensureSignedIn(page);
  await quickAdd(page, `coffee with ${SOLO()} yesterday, they got the promotion`);
  await previewForm(page).getByRole("button", { name: "Log it" }).click();

  await page.goto(`/people?q=${encodeURIComponent(SOLO())}`);
  await page.getByRole("link", { name: new RegExp(SOLO()) }).first().click();
  await expect(page.getByText("they got the promotion")).toBeVisible();
});

test("a name two people share is never guessed", async ({ page }) => {
  await ensureSignedIn(page);
  // Just the shared first name, so there is genuinely nothing to go on.
  await quickAdd(page, `lunch with ${SHARED_FIRST()} on Tuesday`);

  const form = previewForm(page);
  // Both candidates offered, nothing preselected, and saving blocked.
  await expect(form.getByText(/More than one person goes by that name/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Log it" })).toBeDisabled();

  await form.getByText(TWIN_B(), { exact: true }).click();
  await expect(form.getByRole("button", { name: "Log it" })).toBeEnabled();
  await form.getByRole("button", { name: "Log it" }).click();

  // It landed against the one picked. Searched by first name, because the
  // search matches a single field rather than "First Last".
  await page.goto(`/people?q=${encodeURIComponent(SHARED_FIRST())}`);
  await page.getByRole("link", { name: new RegExp(`${SHARED_FIRST()} Bell`) }).first().click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
  await expect(page.getByText(/lunch/i).first()).toBeVisible();

  // And not against the other one.
  await page.goto(`/people?q=${encodeURIComponent(SHARED_FIRST())}`);
  await page.getByRole("link", { name: new RegExp(`${SHARED_FIRST()} Whitfield`) }).first().click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
  await expect(page.getByText(/lunch/i)).toHaveCount(0);
});

test("an unrecognised name is offered as someone new, and can be declined", async ({ page }) => {
  await ensureSignedIn(page);
  const stranger = `Zephyrine${suffix().replace(/[^a-z0-9]/gi, "")}`;

  await quickAdd(page, `coffee with ${SOLO()} and ${stranger} yesterday`);
  const form = previewForm(page);
  await expect(form.getByText("new", { exact: true })).toBeVisible();

  // Declining leaves them out rather than blocking the log.
  await form.getByRole("button", { name: /Don't add anyone new/ }).click();
  await form.getByRole("button", { name: "Log it" }).click();

  await page.goto(`/people?q=${encodeURIComponent(stranger)}`);
  await expect(page.getByRole("link", { name: new RegExp(stranger) })).toHaveCount(0);
});

test("the command palette finds a person and navigates", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Search" }).click();
  const search = page.getByLabel("Search people and commands");
  await expect(search).toBeVisible();

  await search.fill(SOLO().split(" ")[0]);
  await page.getByRole("button", { name: new RegExp(SOLO()) }).first().click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
  await expect(page.getByRole("heading", { name: new RegExp(SOLO()), level: 2 })).toBeVisible();
});

test("the palette's log action opens the sheet, not just the dashboard", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Log an interaction" }).click();

  // It navigates to /?log=1, and the sheet lives with the floating button —
  // for a long time nothing read the parameter, so this landed on the
  // dashboard and stopped.
  await expect(page.getByRole("heading", { name: "Log an interaction" })).toBeVisible();

  // Dismissing drops the parameter, so a reload does not reopen it.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Log an interaction" })).toBeHidden();
});

test("the palette opens on the keyboard shortcut", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByLabel("Search people and commands")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Search people and commands")).toHaveCount(0);
});

test("the floating button logs from wherever you are", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");

  await page.getByRole("button", { name: "Log an interaction" }).click();
  await expect(page.getByRole("heading", { name: "Log an interaction" })).toBeVisible();

  // It is a sheet over the current page, not a navigation.
  await expect(page).toHaveURL(/\/people$/);
});

test("the floating button stays out of the way on form pages", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people/new");
  // A button floating over the field you are typing into is just in the way.
  await expect(page.getByRole("button", { name: "Log an interaction" })).toHaveCount(0);
});

test("quick add works with no API key configured", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Quick add" }).click();

  // The default install: nothing configured, and the copy says the feature
  // still works.
  await expect(page.getByText(/Not configured, so this stays off/)).toBeVisible();
  await expect(page.getByRole("switch", { name: "Use smarter suggestions" })).toBeDisabled();

  await quickAdd(page, `call with ${SOLO()} yesterday`);
  await expect(previewForm(page).getByText(SOLO()).first()).toBeVisible();
});
