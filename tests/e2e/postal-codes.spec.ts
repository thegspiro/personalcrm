import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Filling a city in from a postal code.
 *
 * The file is written from this spec rather than downloaded, so the run says
 * nothing about whether GeoNames is reachable from CI — the same reason the two
 * address specs stand up their own endpoint instead of calling a real geocoder.
 * It is a handful of lines in the published twelve-column shape.
 *
 * The import is removed again in a final **test**, not an `afterAll` hook.
 * `PostalCode` is stored per installation rather than per account, so whatever
 * this leaves behind is what every later spec sees; making the restore an
 * assertion means a failure is reported here rather than surfacing somewhere
 * else as an unrelated spec failing for reasons of its own.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const person = () => `Postal ${test.info().project.name} ${STAMP}`;

/**
 * Two codes: one naming a single place, one naming two.
 *
 * The second is the interesting one — a postal code really can cover more than
 * one town, and the form has to offer rather than choose.
 */
const FILE = [
  "US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.09\t-118.4\t4",
  "US\t12345\tSchenectady\tNew York\tNY\tSchenectady\t093\t\t\t42.81\t-73.93\t4",
  "US\t12345\tGeneral Electric\tNew York\tNY\tSchenectady\t093\t\t\t42.81\t-73.93\t4",
].join("\n");

function postalPanel(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Postal codes" });
}

function addressSection(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Where they are" });
}

test("import a country file", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();

  const panel = postalPanel(page);
  await panel.getByLabel("Country file").setInputFiles({
    name: "US.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(FILE, "utf8"),
  });
  await panel.getByRole("button", { name: "Import" }).click();

  // Says what it stored, so a silent no-op cannot read as success.
  await expect(panel.getByText(/US.*3 codes/)).toBeVisible();
});

test("a postal code fills in the city and the state", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, person());

  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Address", { exact: true }).fill("1 Test Street");
  await addresses.getByLabel("Postal code").fill("90210");
  await addresses.getByRole("button", { name: "Fill city from postal code" }).click();

  await expect(addresses.getByLabel("City")).toHaveValue("Beverly Hills");
  await expect(addresses.getByLabel("State")).toHaveValue("California");

  // And it saves as an ordinary address — the fill is a convenience, not a
  // different kind of record.
  await addresses.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addresses.getByText("Beverly Hills, California")).toBeVisible();
});

test("a code covering two places offers them rather than choosing", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();

  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Address", { exact: true }).fill("2 Test Street");
  await addresses.getByLabel("Postal code").fill("12345");
  await addresses.getByRole("button", { name: "Fill city from postal code" }).click();

  // Nothing is filled in until somebody picks: a wrong city looks exactly like
  // a right one.
  await expect(addresses.getByText("That code covers more than one place")).toBeVisible();
  await expect(addresses.getByLabel("City")).toHaveValue("");

  await addresses.getByRole("button", { name: /Schenectady/ }).first().click();
  await expect(addresses.getByLabel("City")).toHaveValue("Schenectady");
  await expect(addresses.getByLabel("State")).toHaveValue("New York");
});

test("a code nobody imported says so rather than guessing", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();

  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Postal code").fill("99999");
  await addresses.getByRole("button", { name: "Fill city from postal code" }).click();

  await expect(addresses.getByText("No imported postal code matches that")).toBeVisible();
  await expect(addresses.getByLabel("City")).toHaveValue("");
});

test("the import is removed again for the rest of the run", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();

  const panel = postalPanel(page);
  await panel.getByRole("button", { name: "Remove US postal codes" }).click();
  await expect(panel.getByText("No postal codes imported")).toBeVisible();

  // And the control goes with it, so an installation that has imported nothing
  // sees no trace of the feature.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await expect(
    addresses.getByRole("button", { name: "Fill city from postal code" }),
  ).toHaveCount(0);
});
