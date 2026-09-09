import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Placing an address, and the distances that placing it buys.
 *
 * Address lookup is off in the shipped state and needs a network endpoint, so
 * nothing here presses it. Coordinates go in by hand — which is the supported
 * route in its own right, and the *only* route for a private contact.
 *
 * That shipped state is itself asserted below. A field that suggests as you
 * type is a field that sends an address without being asked, so "off means
 * off" is the one thing about the feature that can be proved without a live
 * endpoint — and the thing worth proving, since the failure it catches is the
 * feature quietly defaulting on.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

const person = () => `Placed ${test.info().project.name} ${STAMP}`;
const venue = () => `Nearby Cafe ${test.info().project.name} ${STAMP}`;
const title = () => `Coffee there ${test.info().project.name} ${STAMP}`;

// Leeds city centre, and a café a few hundred metres from it.
const HOME = { lat: "53.8008", lon: "-1.5491" };
const THEIRS = { lat: "53.7965", lon: "-1.5478" };
const VENUE = { lat: "53.7978", lon: "-1.5450" };

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
  // Wait for the save to be acknowledged before navigating. The click starts a
  // server action and `goto` cancels whatever is still in flight, so on a
  // runner slow enough to lose that race the reload below read a home base
  // that was never written — which is how this failed in CI while passing
  // locally every time. The toast is only shown for an `ok` result, so a save
  // that genuinely fails still fails the test, here rather than four lines
  // later and saying so.
  await expect(page.getByText("Saved")).toBeVisible();

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

test("an address field offers no suggestions until it is asked to", async ({ page }) => {
  await ensureSignedIn(page);
  await createContact(page, person());

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();

  const line = addresses.getByLabel("Address", { exact: true });
  // No combobox: the field is a plain text box, and nothing it receives goes
  // anywhere. `role` is the whole of the difference, so it is the whole of the
  // assertion.
  await expect(line).not.toHaveAttribute("role", "combobox");
  await expect(line).not.toHaveAttribute("aria-expanded", /.*/);

  // Typing a real address changes nothing but the box.
  await line.fill("120 Maple Street");
  await expect(addresses.getByRole("listbox")).toHaveCount(0);
  await expect(line).toHaveValue("120 Maple Street");
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

test("a place can be put on the map by hand, and read back as a distance", async ({ page }) => {
  await ensureSignedIn(page);

  // A place is reached through an interaction, the way anyone actually gets
  // one — there is no "create a place" button.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  await sheet.getByLabel("Title").fill(title());
  await sheet.getByLabel("Where").fill(venue());
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(title())).toBeVisible();

  // Address lookup is off in the shipped state, so typing the pair is the only
  // way to place this — which is exactly the case that has to work.
  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(venue()) }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Latitude").fill(VENUE.lat);
  await page.getByLabel("Longitude").fill(VENUE.lon);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Both ends are placed now, so the place says how far it is from home. The
  // home base is in km and the two points are a few hundred metres apart.
  await expect(page.getByText(/0\.\d km from home/)).toBeVisible();

  // And the person, whose own address is placed, gets it offered as somewhere
  // near them — the question the whole change exists to answer.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  const nearby = page.locator("section").filter({ hasText: "Places near them" });
  // Scoped to this venue's own row, and named exactly. The row carries two
  // links to the same place — its name and the map pin, "Open <place> on a
  // map" — and the section itself holds the other project's venue, which is
  // the same distance away because both projects place their points alike.
  const row = nearby.locator("li").filter({ hasText: venue() });
  await expect(row.getByRole("link", { name: venue(), exact: true })).toBeVisible();
  await expect(row.getByText(/^0\.\d km$/)).toBeVisible();
});

test("an address can be copied from a place you have been", async ({ page }) => {
  await ensureSignedIn(page);

  // Give the venue a full address first, so there is something worth copying.
  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(venue()) }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editing = page.getByRole("dialog");
  await editing.getByLabel("Address", { exact: true }).fill("2 Boar Lane");
  await editing.getByLabel("City").fill("Leeds");
  await editing.getByLabel("State").fill("West Yorkshire");
  await editing.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editing).toBeHidden();

  const name = `Copier ${test.info().project.name} ${STAMP}`;
  await createContact(page, name);

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByText("Copy from a place you've been").click();
  await addresses.getByLabel("Search places").fill(venue());
  await addresses.getByRole("button", { name: new RegExp(venue()) }).click();

  // Copied, not linked, and visibly — so it is correctable before Save.
  await expect(addresses.getByLabel("Address", { exact: true })).toHaveValue("2 Boar Lane");
  await expect(addresses.getByLabel("City")).toHaveValue("Leeds");
  await expect(addresses.getByLabel("State")).toHaveValue("West Yorkshire");
  // The place is placed, so its coordinates come across as a pair.
  await expect(addresses.getByLabel("Latitude")).toHaveValue(/^53\.7978/);
  await expect(addresses.getByLabel("Longitude")).toHaveValue(/^-1\.545/);

  await addresses.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addresses.getByText("2 Boar Lane")).toBeVisible();
});

test("a logged date carries the place it happened at", async ({ page }) => {
  await ensureSignedIn(page);

  // The dating module is the part the whole feature exists for, and was the
  // last thing in the app that could not be mapped or measured.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  // Wait for the person's own page before reading the URL off it: taken too
  // early this is still /people, and /people/edit is a 404.
  await page.getByRole("heading", { name: new RegExp(person()), level: 2 }).waitFor();
  const contactUrl = page.url();

  await page.goto(`${contactUrl}/edit`);
  await page.getByText("Dating or interested").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(contactUrl);

  // Scoped by the add button rather than the title: `hasText` is
  // case-insensitive, so "Dates" also matches "Important dates".
  const dates = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Log a date" }) })
    .first();

  await dates.getByRole("button", { name: "Log a date" }).click();
  await dates.getByRole("button", { name: "Coffee", exact: true }).click();
  await dates.getByLabel("Where").fill(venue());
  await dates.getByRole("button", { name: "Log it" }).click();

  // The venue resolves to the place the previous test put on the map, so the
  // logged date reads its distance back without anything else being typed —
  // through the interaction it mirrors, since a DateEntry holds no place of
  // its own.
  const mapLink = page
    .getByRole("link", { name: new RegExp(`Open ${venue()} on a map`) })
    .first();
  await expect(mapLink).toBeVisible();
  await expect(mapLink).toHaveAttribute("href", /mlat=53\.7978/);
  await expect(mapLink).toHaveText(/0\.\d km/);
});
