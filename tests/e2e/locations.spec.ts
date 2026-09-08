import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Places are reached from an interaction, not created directly, so this walks
 * the way someone actually gets one: log a visit with a venue, add a second
 * person to that same visit, then read the place back.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

// The projects share one database, so every name is stamped per project.
const first = () => `LocAda ${test.info().project.name} ${STAMP}`;
const second = () => `LocGrace ${test.info().project.name} ${STAMP}`;
const place = () => `Corner Cafe ${test.info().project.name} ${STAMP}`;
const title = () => `Shared visit ${test.info().project.name} ${STAMP}`;

/** The dialogs carry two contact pickers; only the attendees one is meant. */
function attendees(page: Page, label: string) {
  return page.getByRole("dialog").getByRole("group", { name: label });
}

test("set up the two people this spec works with", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, first());
  await createContact(page, second());
});

test("a visit's place lists everyone who was there", async ({ page }) => {
  await ensureSignedIn(page);

  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(first()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  await sheet.getByLabel("Title").fill(title());
  await sheet.getByLabel("Where").fill(place());
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(title())).toBeVisible();

  // Add the second person to the same visit, so the place has to aggregate
  // across participants rather than just echo whoever logged it.
  await page.goto("/timeline");
  await page.getByRole("button", { name: `Edit ${title()}` }).click();
  const edit = attendees(page, "Who");
  await edit.getByLabel("Search people").fill(second());
  await edit.getByRole("button", { name: second() }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  // The sheet closes only once the server action has resolved, so this is what
  // separates "the edit was submitted" from "the edit was saved". Navigating
  // straight off the click can load the place before the participant lands.
  await expect(dialog).toBeHidden();

  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(place()) }).click();

  await expect(page.getByRole("heading", { name: place() })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(first()) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(second()) })).toBeVisible();
  await expect(page.getByText(title())).toBeVisible();
});

test("a second visit picks the place it already has, rather than retyping it", async ({
  page,
}) => {
  await ensureSignedIn(page);

  // The point of the whole change. Typing a near-miss — "Corner Coffee" for
  // "Corner Cafe" — silently created a second place, splitting one history
  // across two rows and two map pins. Picking cannot miss.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(second()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  const secondTitle = `Second visit ${test.info().project.name} ${STAMP}`;
  await sheet.getByLabel("Title").fill(secondTitle);

  // The picker is a closed disclosure: a form with thirty rows must not draw
  // thirty open lists. It carries no aria-label of its own, deliberately —
  // getByLabel matches one on any element, so a labelled wrapper here would
  // make getByLabel("Where") ambiguous and break every existing locator.
  await sheet.getByText("Pick from your places").click();
  await sheet.getByLabel("Search places").fill(place());
  await sheet.getByRole("button", { name: new RegExp(place()) }).click();

  // Picking fills the box the person would have typed into — that is the whole
  // mechanism, and it is why no locationId crosses the wire.
  await expect(sheet.getByLabel("Where")).toHaveValue(place());
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();

  // One place, both visits. A second row here would mean the pick did not
  // resolve to the place that already existed.
  await page.goto(`/locations?search=${encodeURIComponent(place())}`);
  await expect(page.getByRole("link", { name: new RegExp(place()) })).toHaveCount(1);
  await page.getByRole("link", { name: new RegExp(place()) }).click();
  await expect(page.getByText(title())).toBeVisible();
  await expect(page.getByText(secondTitle)).toBeVisible();
});

test("an alias can be edited and used to find its place", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(place()) }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const alias = `The Local ${STAMP}`;
  await page.getByLabel("Aliases").fill(alias);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto(`/locations?search=${encodeURIComponent(alias)}`);
  await expect(page.getByRole("link", { name: new RegExp(place()) })).toBeVisible();
});
