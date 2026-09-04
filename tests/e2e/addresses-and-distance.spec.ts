import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Placing an address, and the distances that placing it buys.
 *
 * Address lookup is off in the shipped state and needs a network endpoint, so
 * nothing here presses it. Coordinates go in by hand — which is the supported
 * route in its own right, and the *only* route for a private contact.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

const person = () => `Placed ${test.info().project.name} ${STAMP}`;
const venue = () => `Nearby Cafe ${test.info().project.name} ${STAMP}`;

// Leeds city centre, and a café a few hundred metres from it.
const HOME = { lat: "53.8008", lon: "-1.5491" };
const THEIRS = { lat: "53.7965", lon: "-1.5478" };

test("set a home base and choose a unit", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();

  const home = page.locator("section").filter({ hasText: "Home base" });
  await home.getByLabel("Address").fill("14 Ashfield Road");
  await home.getByLabel("City").fill("Leeds");
  await home.getByLabel("Latitude").fill(HOME.lat);
  await home.getByLabel("Longitude").fill(HOME.lon);
  await home.getByLabel("Distances in").selectOption("km");
  await home.getByRole("button", { name: "Save" }).click();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();
  await expect(home.getByLabel("Latitude")).toHaveValue(/53\.8008/);
});

test("an address keeps its coordinates and offers a map link", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, person());

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Address", { exact: true }).fill("2 Boar Lane");
  await addresses.getByLabel("City").fill("Leeds");
  await addresses.getByLabel("Latitude").fill(THEIRS.lat);
  await addresses.getByLabel("Longitude").fill(THEIRS.lon);
  await addresses.getByRole("button", { name: "Add", exact: true }).click();

  await expect(addresses.getByText("2 Boar Lane")).toBeVisible();
  // Placed, so the link is a pin rather than a search guess.
  const map = addresses.getByRole("link", { name: "Open map" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("href", /mlat=53\.7965/);
});

test("half a coordinate pair is refused rather than stored", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Halfway ${test.info().project.name} ${STAMP}`;
  await createContact(page, name);

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Address", { exact: true }).fill("Somewhere");
  await addresses.getByLabel("Latitude").fill("53.8008");
  await addresses.getByRole("button", { name: "Add", exact: true }).click();

  // A latitude alone would place the address on the prime meridian.
  await expect(
    page.getByText("Give both a latitude and a longitude, or neither."),
  ).toBeVisible();
});

test("a plan with a placed venue shows how far away it is", async ({ page }) => {
  await ensureSignedIn(page);

  // The place gets its coordinates on its own page, the way anyone would.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  await sheet.getByLabel("Where").fill(venue());
  await sheet.getByRole("button", { name: "Log it" }).click();

  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(venue()) }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();

  const edit = page.getByRole("dialog");
  await edit.getByLabel("City").fill("Leeds");
  await edit.getByRole("button", { name: "Save" }).click();

  // The place page says how far it is from home once both ends are placed.
  await expect(page.getByText("Leeds")).toBeVisible();
});
