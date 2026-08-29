import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

test("dashboard, timeline, and person page agree on the next occurrence", async ({ page }) => {
  await ensureSignedIn(page);
  const stamp = `${test.info().project.name}-${Date.now().toString(36)}`;
  const label = `Shared occurrence ${stamp}`;
  const contactUrl = await createContact(page, `Occurrence ${stamp}`);

  const dates = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add a date" }) })
    .first();
  await dates.getByRole("button", { name: "Add a date" }).click();
  await dates.getByLabel("What is it?").fill(label);
  await dates.getByRole("button", { name: "When" }).click();
  await page.getByLabel("Type a date").fill("today");
  await page.getByLabel("Type a date").press("Enter");
  await dates.getByRole("button", { name: "Add", exact: true }).click();

  async function expectComingUp() {
    const comingUp = page.getByTestId("widget-upcoming-dates");
    await expect(comingUp.getByText(label)).toBeVisible();
    return comingUp.locator("li").filter({ hasText: label }).textContent();
  }

  await page.goto(contactUrl);
  const personOccurrence = await expectComingUp();

  await page.goto("/timeline");
  const timelineOccurrence = await expectComingUp();
  await expect(page.locator("article").filter({ hasText: label })).toHaveCount(0);

  await page.goto("/");
  const dashboardOccurrence = await expectComingUp();
  expect(timelineOccurrence).toBe(personOccurrence);
  expect(dashboardOccurrence).toBe(personOccurrence);
});
