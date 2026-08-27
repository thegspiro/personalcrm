import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Fixing something already logged.
 *
 * The end of the loop quick add opens: it reads one typed line into a person,
 * a type and a date, and until now a misreading was permanent — the timeline
 * offered deletion and nothing else. The case worth walking through end to end
 * is the one that produced this: a possessive title, which the parser used to
 * hollow out into "First time at 's place".
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const suffix = () => `${test.info().project.name}-${STAMP}`;
const PERSON = () => `Ondrell${suffix().replace(/[^a-z0-9]/gi, "")}`;

/** The row for one interaction in the timeline feed. */
function row(page: Page, title: string) {
  return page.locator("article").filter({ hasText: title }).first();
}

test("set up the person these tests log against", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, PERSON());
});

test("quick add keeps a possessive name in the title", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");

  await page
    .getByLabel("Describe what happened")
    .fill(`first time at ${PERSON()}'s place hangout`);
  await page.getByRole("button", { name: "Read" }).click();

  const form = page.locator("form").filter({ hasText: "From " }).first();
  await expect(form).toBeVisible();
  // "hangout" is taken as the type, and the person is matched — but the name
  // still reads as part of the sentence. This used to come out "first time at
  // 's place", which is the whole reason any of this changed. The preview
  // calls the title field "What".
  await expect(form.getByLabel("What")).toHaveValue(`first time at ${PERSON()}'s place`);
  await form.getByRole("button", { name: "Log it" }).click();
});

test("a logged interaction can be retitled from the timeline", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");

  const original = `first time at ${PERSON()}'s place`;
  const corrected = `First night at ${PERSON()}'s new place`;

  await expect(row(page, original)).toBeVisible();
  await row(page, original).getByRole("button", { name: `Edit ${original}` }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Title")).toHaveValue(original);
  await sheet.getByLabel("Title").fill(corrected);
  await sheet.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText(corrected)).toBeVisible();
  await expect(page.getByText(original, { exact: true })).toHaveCount(0);
});

test("the edit sheet opens with the record already filled in", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");

  const title = `First night at ${PERSON()}'s new place`;
  await row(page, title).getByRole("button", { name: `Edit ${title}` }).click();

  const sheet = page.getByRole("dialog");
  // The person on the record is selected, not left for you to pick again.
  await expect(sheet.getByText(PERSON()).first()).toBeVisible();
  await expect(sheet.getByLabel("Title")).toHaveValue(title);
});

test("an edit that changes the notes keeps everything else", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");

  const title = `First night at ${PERSON()}'s new place`;
  await row(page, title).getByRole("button", { name: `Edit ${title}` }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Notes").fill("met the flatmates");
  await sheet.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("met the flatmates")).toBeVisible();
  // Editing one field must not blank the others.
  await expect(page.getByText(title)).toBeVisible();
});
