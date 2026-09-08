import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * The calendar subscription, end to end.
 *
 * The point of the feature is that something outside the app can fetch the URL
 * without signing in, so the assertions that matter are made by fetching it
 * exactly that way — with a bare request context that carries none of the
 * browser's cookies.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const PERSON = `Feedsub ${STAMP}`;

let feedUrl = "";

async function openDataSettings(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Data" }).click();
}

test("a subscription address can be created and copied", async ({ page }) => {
  await ensureSignedIn(page);

  // Someone with a birthday, so the feed has something to carry.
  await createContact(page, PERSON);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(PERSON) }).first().click();

  await openDataSettings(page);
  await expect(page.getByRole("heading", { name: "Calendar subscription" })).toBeVisible();

  await page.getByRole("button", { name: "Create a subscription" }).click();

  const field = page.getByLabel("Your address");
  await expect(field).toBeVisible();
  feedUrl = await field.inputValue();
  expect(feedUrl).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/);
});

test("the address serves a calendar to something that is not signed in", async ({
  playwright,
  baseURL,
}) => {
  expect(feedUrl, "the previous test must have produced an address").not.toBe("");

  // A fresh context: no cookies, no session, exactly what Google or Apple has.
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get(feedUrl);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");

  const body = await response.text();
  expect(body.startsWith("BEGIN:VCALENDAR")).toBe(true);
  expect(body).toContain("X-WR-CALNAME:Personal CRM");

  await anonymous.dispose();
});

test("an address the server never issued is refused", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get(`/api/calendar/${"z".repeat(43)}.ics`);
  // 404 for every refusal alike: whether a URL was ever valid is itself a
  // disclosure.
  expect(response.status()).toBe(404);
  await anonymous.dispose();
});

test("creating a new address stops the old one working", async ({
  page,
  playwright,
  baseURL,
}) => {
  await ensureSignedIn(page);
  await openDataSettings(page);

  const previous = feedUrl;
  await page.getByRole("button", { name: "Create a new address" }).click();

  const field = page.getByLabel("Your address");
  await expect(field).not.toHaveValue(previous);
  feedUrl = await field.inputValue();

  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(previous)).status()).toBe(404);
  expect((await anonymous.get(feedUrl)).status()).toBe(200);
  await anonymous.dispose();
});

test("turning the subscription off stops the address entirely", async ({
  page,
  playwright,
  baseURL,
}) => {
  await ensureSignedIn(page);
  await openDataSettings(page);

  const retired = feedUrl;
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: "Create a subscription" })).toBeVisible();

  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(retired)).status()).toBe(404);
  await anonymous.dispose();
});
