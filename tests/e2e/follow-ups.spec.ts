import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

test("the follow-up hub connects cadence reminders and manual tasks", async ({
  page,
}) => {
  await ensureSignedIn(page);
  const person = `Followup ${test.info().project.name} ${STAMP}`;
  const taskTitle = `Send notes ${test.info().project.name} ${STAMP}`;

  // Someone with no cadence at all: they belong in People and must not appear
  // behind the due filter, which is the difference between filtering and
  // merely re-sorting.
  const noCadence = `Nocadence ${test.info().project.name} ${STAMP}`;
  await createContact(page, noCadence);

  await page.goto("/people/new");
  await page.getByLabel("First name").fill(person);
  await page
    .getByLabel("Remind me to reach out")
    .selectOption({ label: "Every 2 weeks" });
  await page.getByRole("button", { name: "Add person" }).click();

  // Backdate an interaction so the cadence is deterministically overdue.
  await page.getByRole("button", { name: "Log interaction" }).click();
  const interaction = page.getByRole("dialog");
  await interaction
    .getByRole("button", { name: "Coffee", exact: true })
    .click();
  for (let i = 0; i < 3; i++)
    await interaction.getByRole("button", { name: "−1 month" }).click();
  await interaction.getByLabel("Title").fill(`Old coffee ${STAMP}`);
  await interaction.getByRole("button", { name: "Log it" }).click();

  const tasks = page.locator("section").filter({ hasText: "Tasks" }).first();
  await tasks.getByRole("button", { name: "Add a task" }).click();
  await tasks.getByLabel("What do you need to do?").fill(taskTitle);
  await tasks.getByRole("button", { name: "Add", exact: true }).click();

  await page.goto("/");
  // "Time to reach out" leads to the filtered People list; the hub is reached
  // from the tasks widget. Two headings, two destinations, one link each.
  await expect(
    page.getByTestId("widget-overdue").getByRole("link", { name: "See all" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All follow-ups" }).click();

  await expect(
    page.getByRole("heading", { name: "People to contact" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Things to do" }),
  ).toBeVisible();
  // The same person is linked twice here: once as someone to contact, and once
  // from their own task in the section below. Scope to the section being
  // asserted rather than matching the name across the whole page.
  const toContact = page.locator("#people-to-contact");
  await expect(toContact.getByRole("link", { name: new RegExp(person) })).toBeVisible();
  await expect(page.getByText(taskTitle)).toBeVisible();

  await toContact.getByRole("link", { name: new RegExp(person) }).click();
  await expect(
    page.getByRole("heading", { name: person, level: 2 }),
  ).toBeVisible();
  await page.goto("/tasks#things-to-do");
  const task = page.locator("li").filter({ hasText: taskTitle }).first();
  await task.getByRole("button", { name: "Edit task" }).click();
  await task.getByLabel("What do you need to do?").fill(`${taskTitle} today`);
  await task.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`${taskTitle} today`)).toBeVisible();
  await task.getByRole("checkbox", { name: "Toggle done" }).click();

  // The same destination is present in the phone overflow navigation and the
  // desktop sidebar; Playwright runs this spec in both responsive projects.
  if (test.info().project.name === "mobile") {
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "More" })
      .click();
    await page.getByRole("link", { name: "Follow-ups" }).click();
  } else {
    await page.getByRole("link", { name: "Follow-ups" }).click();
  }
  await expect(page.getByRole("heading", { name: "Follow-ups" })).toBeVisible();

  // "Time to reach out" leads to People filtered to who it was showing, not to
  // the whole list re-sorted. Asserted here rather than in contacts.spec.ts,
  // whose person is deliberately contacted again mid-suite.
  await page.goto("/");
  await page
    .getByTestId("widget-overdue")
    .getByRole("link", { name: "See all" })
    .click();
  await expect(page).toHaveURL(/due=soon/);
  await expect(page.getByRole("link", { name: new RegExp(person) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(noCadence) })).toHaveCount(0);

  // Every control edits the existing URLSearchParams. Exercise one of them to
  // guard the due filter against being dropped as other filters change.
  await page.getByRole("button", { name: "Favourites" }).click();
  await expect(page).toHaveURL(/due=soon/);
  await expect(page).toHaveURL(/favorites=1/);
});
