import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn, setAddressLookup } from "./helpers";

/**
 * Suggestions while you type, end to end.
 *
 * The unit and integration tests cover the rules — `shouldSuggest` decides when
 * a request is allowed, and the action decides what may be sent — but nothing
 * proved they were *wired* to a real form. That gap is how a keyboard
 * regression shipped once already.
 *
 * The endpoint here records what it was asked, which is the point: half of what
 * matters about this feature is when it stays silent. "Nothing was sent" is an
 * assertion on that log rather than on the absence of a visible list, because a
 * list can be absent for a dozen uninteresting reasons.
 *
 * Every negative is paired with a positive on the same page. A test that proves
 * no request was made is worthless if the feature is simply broken — it would
 * pass all the more easily — so each one goes on to show a request the same
 * field *does* make.
 *
 * A private contact is deliberately **not** covered here. The guarantee is that
 * nothing reaches the provider, and
 * `tests/integration/address-typeahead.test.ts` asserts exactly that against the
 * queries the action actually sent, locked and unlocked — which is a stronger
 * claim than "no list appeared". Reproducing it here would mean setting a PIN,
 * unlocking, and marking somebody private before this spec's real subject
 * begins, then undoing all three: a contact left private switches offline
 * caching off account-wide and fails a later project for no visible reason.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const person = () => `Typeahead ${test.info().project.name} ${STAMP}`;
const venue = () => `Typeahead Cafe ${test.info().project.name} ${STAMP}`;
const visit = () => `Typeahead visit ${test.info().project.name} ${STAMP}`;

/**
 * Long enough to pass the four-character minimum and to look like an address.
 * `SAVED` is what a contact already has on file before typeahead is switched on.
 */
const SAVED = {
  label: "Old flat",
  line1: "9 Alder Row",
  city: "Leeds",
  country: "United Kingdom",
};
const TYPED = "120 Maple Street";

const MATCH = {
  display_name: "120, Maple Street, Arlington, Virginia, 22201, United States",
  lat: "38.8809",
  lon: "-77.1728",
  osm_type: "way",
  osm_id: 123456789,
  address: {
    house_number: "120",
    road: "Maple Street",
    city: "Arlington",
    state: "Virginia",
    country: "United States",
  },
};

/** Every query the app actually sent, in order. The assertion surface. */
let asked: string[] = [];
let endpoint: Server;
let baseUrl = "";

test.beforeAll(async () => {
  endpoint = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://placeholder");
    asked.push(url.searchParams.get("q") ?? "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([MATCH]));
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const address = endpoint.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  // Loopback, so the app treats it as this machine's and applies no spacing —
  // otherwise a test asserting one request would race an interval meant to
  // protect somebody else's server.
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => endpoint.close(() => resolve()));
});

/**
 * Long enough that a suggestion would certainly have fired.
 *
 * A fixed wait, deliberately, and the one case that calls for one: proving a
 * request was *not* made means waiting out the window in which it could have
 * been. Several times the 350ms debounce, so a slow machine does not turn a
 * real regression into a pass.
 */
const PAST_THE_DEBOUNCE = 1_500;

function addressSection(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Where they are" });
}

test("set up a person who already has an address on file", async ({ page }) => {
  await ensureSignedIn(page);
  // Lookup off while this is typed, so the address arrives without any of it
  // having been sent anywhere — which is the state the next test needs.
  await setAddressLookup(page, { lookup: false });

  await createContact(page, person());
  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  await addresses.getByLabel("Label (optional)").fill(SAVED.label);
  await addresses.getByLabel("Address", { exact: true }).fill(SAVED.line1);
  await addresses.getByLabel("City").fill(SAVED.city);
  await addresses.getByLabel("Country").fill(SAVED.country);
  await addresses.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addresses.getByText(SAVED.line1)).toBeVisible();
});

test("opening a form on an address already filled in sends nothing", async ({ page }) => {
  await ensureSignedIn(page);
  await setAddressLookup(page, { lookup: true, typeahead: true, baseUrl });

  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();

  const addresses = addressSection(page);
  asked = [];
  // The row's edit control is named from the address's label, not its street.
  await addresses.getByRole("button", { name: `Edit ${SAVED.label}` }).click();

  const line = addresses.getByLabel("Address", { exact: true });
  await expect(line).toHaveValue(SAVED.line1);

  // The query a form sends is a join of its lines, city, region and country, so
  // this one opens holding "9 Alder Row, Leeds, United Kingdom" — long enough
  // and plausible enough to be sent. Nothing may go out until somebody types.
  await page.waitForTimeout(PAST_THE_DEBOUNCE);
  expect(asked).toEqual([]);

  // And the field is live, not inert: the silence above is a rule being kept,
  // not the feature being broken.
  await line.fill(TYPED);
  await expect.poll(() => asked.length).toBeGreaterThan(0);
});

test("typing offers suggestions, and accepting one fills the address in", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();

  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  const line = addresses.getByLabel("Address", { exact: true });

  asked = [];
  await line.fill(TYPED);

  const list = addresses.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(1);
  // What was sent is the address and nothing else — never the label, the notes,
  // or the name of the person who lives there.
  expect(asked.at(-1)).toContain("120 Maple Street");
  expect(asked.at(-1)).not.toContain(person());

  await list.getByRole("option").first().click();
  await expect(list).toBeHidden();
  await expect(line).toHaveValue("120 Maple Street");
  await expect(addresses.getByLabel("City")).toHaveValue("Arlington");
  await expect(addresses.getByLabel("State")).toHaveValue("Virginia");

  // Accepting writes the street back, which changes the query — and must not
  // reopen the list under the field just resolved.
  await page.waitForTimeout(PAST_THE_DEBOUNCE);
  await expect(list).toBeHidden();
});

test("a few characters are not a question worth asking", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();

  const addresses = addressSection(page);
  await addresses.getByRole("button", { name: "Add an address" }).click();
  const line = addresses.getByLabel("Address", { exact: true });

  asked = [];
  await line.fill("12");
  await page.waitForTimeout(PAST_THE_DEBOUNCE);
  expect(asked).toEqual([]);

  // One more character past the minimum and it asks, so the silence above is
  // the length rule rather than a field that never fires.
  await line.fill("1200");
  await expect.poll(() => asked.length).toBeGreaterThan(0);
});

test("renaming a place sends nothing; editing its address asks", async ({ page }) => {
  await ensureSignedIn(page);

  // Places are reached through an interaction rather than created directly.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(person()) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Coffee", exact: true }).click();
  await sheet.getByLabel("Title").fill(visit());
  await sheet.getByLabel("Where").fill(venue());
  await sheet.getByRole("button", { name: "Log it" }).click();
  // Waited on before moving: the place only exists once the interaction naming
  // it has been written, so navigating straight on races the save.
  await expect(page.getByText(visit())).toBeVisible();

  await page.goto("/locations");
  await page.getByRole("link", { name: new RegExp(venue()) }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();

  const editor = page.getByRole("dialog");
  asked = [];

  // The button sends the name and the address together, so the name is part of
  // the query — but typing in it is not typing an address, and the switch only
  // offered to suggest while an address is typed.
  await editor.getByLabel("Name").fill(`${venue()} Renamed`);
  await page.waitForTimeout(PAST_THE_DEBOUNCE);
  expect(asked).toEqual([]);

  // The address field is what the offer was about.
  await editor.getByLabel("Address", { exact: true }).fill(TYPED);
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  // And the name still travels with it, because it helps place the venue.
  expect(asked.at(-1)).toContain("Renamed");
});

test("address lookup and its typeahead are switched back off for the rest of the run", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await setAddressLookup(page, { lookup: false, typeahead: false });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();
  const panel = page.locator("section").filter({ hasText: "Address lookup" });
  await expect(
    panel.getByRole("switch", { name: "Use address lookup" }),
  ).toHaveAttribute("aria-checked", "false");
});
