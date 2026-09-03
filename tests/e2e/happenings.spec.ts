import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

/**
 * Informal calendar information, from the form to the dashboard.
 *
 * Covers the two things the feature is for: seeing what someone has on before
 * you invite them anywhere, and being reminded to ask about it afterwards. The
 * follow-up is an ordinary task, so the proof it works is that it turns up on
 * the tasks page.
 */

/**
 * Set a DateField by its label, through the popover's own text box.
 *
 * Enter commits and closes the popover, so there is no Done to click
 * afterwards. Typing "October 2026" also sets MONTH precision on its own —
 * which is the behaviour the vague-date test is there to prove.
 */
async function setDate(page: Page, label: string, text: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const typed = page.getByLabel("Type a date");
  await typed.fill(text);
  await typed.press("Enter");
  await expect(typed).toBeHidden();
}

test("what someone has on reaches their profile, the dashboard and the task list", async ({
  page,
}) => {
  await ensureSignedIn(page);
  const person = `Happening ${test.info().project.name} ${STAMP}`;
  const title = `Trip to Portugal ${STAMP}`;

  const contactUrl = await createContact(page, person);

  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();

  await section.getByLabel("What have they got on?").fill(title);
  await setDate(page, "When", "2026-09-12");
  await setDate(page, "Until", "2026-09-19");
  await section.getByRole("button", { name: "Away — out of town" }).click();
  await section.getByLabel("How did you hear?").fill("Mentioned it at dinner");
  await section.getByText("Remind me to ask how it went").click();
  await section.getByRole("button", { name: "Add", exact: true }).click();

  // The row, with the availability the trip implies.
  const row = section.getByText(title, { exact: true });
  await expect(row).toBeVisible();
  await expect(section).toContainText("Away");
  await expect(section).toContainText("September 12, 2026 – September 19, 2026");
  await expect(section).toContainText("Heard: Mentioned it at dinner");

  // The follow-up is a real task, due the day after the trip ends.
  await page.goto("/tasks");
  const task = page.getByText(`Ask how “${title}” went`, { exact: true });
  await expect(task).toBeVisible();

  // Correcting the trip moves the same task rather than adding a second one.
  await page.goto(contactUrl);
  const editable = page.locator("section#happenings");
  await editable.scrollIntoViewIfNeeded();
  await editable.getByRole("button", { name: "Edit happening" }).first().click();
  await setDate(page, "Until", "2026-09-26");
  await editable.getByRole("button", { name: "Save" }).click();
  await expect(editable).toContainText("September 12, 2026 – September 26, 2026");

  await page.goto("/tasks");
  await expect(page.getByText(`Ask how “${title}” went`, { exact: true })).toHaveCount(1);
});

test("something under way now leads the dashboard list", async ({ page }) => {
  await ensureSignedIn(page);
  const person = `Nowaway ${test.info().project.name} ${STAMP}`;
  const title = `Visitors staying ${STAMP}`;

  await createContact(page, person);

  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();
  await section.getByLabel("What have they got on?").fill(title);
  await setDate(page, "When", "today");
  await section.getByRole("button", { name: "Busy — around, but committed" }).click();
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByText(title, { exact: true })).toBeVisible();

  // Today's is under way, so it leads the widget's "Coming up" list.
  await page.goto("/");
  const widget = page.getByTestId("happenings-widget");
  await expect(widget).toBeVisible();
  await expect(widget).toContainText(title);
  await expect(widget).toContainText("Coming up");
  await expect(widget).toContainText("Busy");
});

test("something that has just finished asks to be followed up, then dismisses", async ({
  page,
}) => {
  await ensureSignedIn(page);
  const person = `Justback ${test.info().project.name} ${STAMP}`;
  const title = `Conference ${STAMP}`;

  await createContact(page, person);

  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();
  await section.getByLabel("What have they got on?").fill(title);
  await setDate(page, "When", "5 days ago");
  await setDate(page, "Until", "2 days ago");
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByText(title, { exact: true })).toBeVisible();

  await page.goto("/");
  const widget = page.getByTestId("happenings-widget");
  await expect(widget).toContainText("Ask how it went");
  await expect(widget).toContainText(title);

  await widget.getByRole("button", { name: `Dismiss ${title}` }).click();
  await expect(widget.getByText(title, { exact: true })).toHaveCount(0);

  // Dismissing clears the prompt without destroying the record.
  await page.goto("/people");
  await page.getByRole("link", { name: person }).first().click();
  const after = page.locator("section#happenings");
  await after.scrollIntoViewIfNeeded();
  await expect(after.getByText(title, { exact: true })).toBeVisible();
});

test("a vague date stays vague rather than becoming a day nobody named", async ({ page }) => {
  await ensureSignedIn(page);
  const person = `Vague ${test.info().project.name} ${STAMP}`;
  const title = `Somewhere in October ${STAMP}`;

  await createContact(page, person);

  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();
  await section.getByLabel("What have they got on?").fill(title);
  await setDate(page, "When", "October 2026");
  await section.getByText("Not certain — they might not be doing this").click();
  await section.getByRole("button", { name: "Add", exact: true }).click();

  // "October 2026", never "October 1, 2026".
  await expect(section).toContainText("October 2026");
  await expect(section).not.toContainText("October 1, 2026");
  await expect(section).toContainText("Maybe");
});

test("an end before the start is refused without leaving the form", async ({ page }) => {
  await ensureSignedIn(page);
  const person = `Backwards ${test.info().project.name} ${STAMP}`;

  await createContact(page, person);

  const section = page.locator("section#happenings");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Add something they have on" }).click();
  await section.getByLabel("What have they got on?").fill(`Impossible ${STAMP}`);
  await setDate(page, "When", "2026-09-19");
  await setDate(page, "Until", "2026-09-12");
  await section.getByRole("button", { name: "Add", exact: true }).click();

  await expect(section).toContainText("End date must not be before the start date.");
  // The form is still open with the entry in it, not silently discarded.
  await expect(section.getByLabel("What have they got on?")).toHaveValue(
    `Impossible ${STAMP}`,
  );
});
