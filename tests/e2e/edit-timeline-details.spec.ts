import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const PERSON = () => `Timeline${test.info().project.name}${STAMP}`.replace(/[^a-z0-9]/gi, "");
let personUrl = "";

function section(page: Page, title: string) {
  return page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).first();
}

function card(page: Page, title: string) {
  return page.locator("article").filter({ hasText: title }).first();
}

async function chooseYear(page: Page, scope: ReturnType<typeof section>, label: string, year: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByPlaceholder("2019, March 2019, 3 years ago…").fill(year);
  await page.keyboard.press("Enter");
}

test("create timeline details", async ({ page }) => {
  await ensureSignedIn(page);
  personUrl = await createContact(page, PERSON());

  const dates = section(page, "Important dates");
  await dates.getByRole("button", { name: "Add a date" }).click();
  await dates.getByLabel("What is it?").fill("Original important date");
  await chooseYear(page, dates, "When", "2011");
  await dates.getByRole("button", { name: "Add", exact: true }).click();

  const events = section(page, "Life events");
  await events.getByRole("button", { name: "Add a life event" }).click();
  await events.getByLabel("What happened?").fill("Original life event");
  await chooseYear(page, events, "When", "2012");
  await events.getByRole("button", { name: "Add", exact: true }).click();
});

test("edit an Important date from global and person timelines", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");
  await card(page, "Original important date").getByRole("button", { name: "Edit Original important date" }).click();
  await page.getByLabel("What is it?").fill("Important date from global timeline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card(page, "Important date from global timeline")).toBeVisible();

  await page.goto(personUrl);
  await card(page, "Important date from global timeline").getByRole("button", { name: "Edit Important date from global timeline" }).click();
  await page.getByLabel("What is it?").fill("Important date from person timeline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page, "Important dates").getByText("Important date from person timeline")).toBeVisible();
  await page.goto("/timeline");
  await expect(card(page, "Important date from person timeline")).toBeVisible();
});

test("edit a Life event from global and person timelines", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline");
  await card(page, "Original life event").getByRole("button", { name: "Edit Original life event" }).click();
  await page.getByLabel("What happened?").fill("Life event from global timeline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card(page, "Life event from global timeline")).toBeVisible();

  await page.goto(personUrl);
  await card(page, "Life event from global timeline").getByRole("button", { name: "Edit Life event from global timeline" }).click();
  await page.getByLabel("What happened?").fill("Life event from person timeline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page, "Life events").getByText("Life event from person timeline")).toBeVisible();
  await page.goto("/timeline");
  await expect(card(page, "Life event from person timeline")).toBeVisible();
});
