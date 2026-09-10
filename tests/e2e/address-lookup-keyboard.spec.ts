import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * Choosing a looked-up address without a mouse.
 *
 * The one thing about the lookup that needs a live endpoint to prove, and the
 * reason it is worth the trouble: the results of pressing "Look up" were once
 * rendered as rows that could not be focused or activated from the keyboard, so
 * a keyboard-only user could ask the question and never reach the answer. That
 * shipped, because nothing here exercised it — the rest of the suite runs with
 * lookup switched off, which is the shipped state.
 *
 * The endpoint is a few lines of `http` in this file rather than a real
 * geocoder, so the test is hermetic and says nothing about OpenStreetMap being
 * reachable from CI. It speaks the Nominatim reply shape, which is what the
 * "Self-hosted or other" provider expects.
 *
 * Suggestions-while-typing stays **off** throughout. This is deliberately the
 * default configuration with lookup on — the one the regression was in.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const person = () => `Keyboard ${test.info().project.name} ${STAMP}`;

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

let endpoint: Server;
let baseUrl = "";

test.beforeAll(async () => {
  endpoint = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([MATCH]));
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const address = endpoint.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  // Loopback, so the app's own spacing treats it as this machine's and the
  // test does not wait out an interval meant to protect somebody else.
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => endpoint.close(() => resolve()));
});

/**
 * Address lookup is stored per installation, not per account, so leaving it on
 * would change what every other spec in the run sees — starting with the one
 * that asserts an address field offers nothing until asked. Switching it off is
 * a test in its own right rather than a cleanup hook, so a failure to restore
 * is reported here instead of as a mystery in another file.
 */
async function setLookup(page: import("@playwright/test").Page, on: boolean) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();
  const panel = page.locator("section").filter({ hasText: "Address lookup" });

  if (on) {
    await panel.getByLabel("Provider").selectOption("custom");
    await panel.getByLabel("Endpoint").fill(baseUrl);
    await panel.getByRole("button", { name: "Save connection" }).click();
    // The toast is portalled to the document root, so it is not inside `panel`.
    await expect(page.getByText("Connection saved")).toBeVisible();
  }

  // Read through `aria-checked` rather than `isChecked()`: this is a Radix
  // switch, a button with `role="switch"`, not a checkbox input.
  const toggle = panel.getByRole("switch", { name: "Use address lookup" });
  const want = on ? "true" : "false";
  if ((await toggle.getAttribute("aria-checked")) !== want) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", want);
}

test("a looked-up address can be chosen from the keyboard", async ({ page }) => {
  await ensureSignedIn(page);
  await setLookup(page, true);

  await createContact(page, person());
  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();

  const line = addresses.getByLabel("Address", { exact: true });
  await line.fill("120 Maple Street");

  // Pressed the way a keyboard user presses it, so focus really is on the
  // button when the results arrive rather than left on the field by a click.
  const button = addresses.getByRole("button", { name: "Look up this address" });
  await button.focus();
  await page.keyboard.press("Enter");

  const list = addresses.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(1);

  // Focus has followed the answer, which is what makes the arrow keys reach it:
  // the button sits several fields below the input the combobox lives on.
  await expect(line).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  // Accepted: the street replaces what was typed, the locality is filled in,
  // and the list is gone. Enter chose a candidate rather than saving the form.
  await expect(list).toBeHidden();
  await expect(line).toHaveValue("120 Maple Street");
  await expect(addresses.getByLabel("City")).toHaveValue("Arlington");
  await expect(addresses.getByLabel("State")).toHaveValue("Virginia");

  await addresses.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addresses.getByText("Arlington, Virginia")).toBeVisible();
});

test("escape closes the suggestions without closing the form", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await page.getByRole("link", { name: person() }).first().click();

  const addresses = page.locator("section").filter({ hasText: "Where they are" });
  await addresses.getByRole("button", { name: "Add an address" }).click();

  const line = addresses.getByLabel("Address", { exact: true });
  await line.fill("120 Maple Street");
  await addresses.getByRole("button", { name: "Look up this address" }).click();
  await expect(addresses.getByRole("listbox")).toBeVisible();

  await line.press("Escape");
  await expect(addresses.getByRole("listbox")).toBeHidden();
  // The form is still open and still holds what was typed — Escape dismissed
  // the list, not the work.
  await expect(line).toHaveValue("120 Maple Street");
});

test("address lookup is switched back off for the rest of the run", async ({ page }) => {
  await ensureSignedIn(page);
  await setLookup(page, false);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();
  const panel = page.locator("section").filter({ hasText: "Address lookup" });
  await expect(
    panel.getByRole("switch", { name: "Use address lookup" }),
  ).toHaveAttribute("aria-checked", "false");
});
