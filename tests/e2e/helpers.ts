import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The account the suite uses. Created by first-run setup if the instance is
 * empty; otherwise assumed to already exist (see ensureAccount).
 */
export const ACCOUNT = {
  name: "Test Owner",
  email: `owner+${process.env.E2E_RUN_ID ?? "local"}@example.com`,
  password: "correct-horse-9-battery",
};

export const FIRST_NAME = ACCOUNT.name.split(" ")[0];

/** True when no account exists yet, i.e. /setup is still open. */
export async function isFirstRun(page: Page): Promise<boolean> {
  const response = await page.request.get("/setup", { maxRedirects: 0 });
  return response.status() === 200;
}

/**
 * Get to the dashboard from wherever authenticating left us.
 *
 * A new account lands in the first-run wizard rather than on the dashboard, and
 * the app shell keeps sending it back there until the wizard is finished or
 * skipped. Every helper that signs in goes through this so the rest of the
 * suite can assume a dashboard.
 */
export async function skipOnboardingIfShown(page: Page): Promise<void> {
  await page.waitForURL(/\/(welcome)?$/);
  if (!page.url().endsWith("/welcome")) return;

  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL("/");
}

export async function completeSetup(page: Page): Promise<void> {
  await page.goto("/setup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account & continue" }).click();
  await skipOnboardingIfShown(page);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await skipOnboardingIfShown(page);
}

/** Register the suite's account through the signup form. */
export async function signUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(ACCOUNT.name);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await skipOnboardingIfShown(page);
}

/**
 * Get to a signed-in state whatever the instance already contains: run
 * first-run setup on an empty one, sign in when the account exists, and
 * register when it doesn't. That lets the suite run against a fresh container
 * or an instance that already has data, without a manual reset.
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  if (await isFirstRun(page)) {
    await completeSetup(page);
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Either we land signed in — on the dashboard, or in the wizard if this
  // account never finished it — or the credentials were rejected because the
  // account has not been created on this instance yet.
  const landed = await page
    .waitForURL(/\/(welcome)?$/, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (landed) {
    await skipOnboardingIfShown(page);
    return;
  }

  await signUp(page);
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
}

/**
 * Create a contact and return the URL of its page.
 *
 * Waits on the rendered heading rather than a URL pattern: `/people/new`
 * matches an id-shaped path too, so a naive URL match resolves while still on
 * the form, before the contact has been saved at all.
 */
export async function createContact(page: Page, firstName: string): Promise<string> {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(firstName);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("heading", { name: firstName, level: 2 }).waitFor();
  return page.url();
}

/**
 * Open the privacy section of settings.
 *
 * Settings is tabbed, so landing on /settings is no longer enough to see the
 * privacy controls.
 */
export async function openPrivacySettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Privacy" }).click();
  await page.getByText(/doesn't encrypt anything/i).waitFor();
}

/**
 * Switch the optional address lookup on or off, and its typeahead with it.
 *
 * Shared because two specs need it and both are changing an `AppSetting`, which
 * is stored per *installation* rather than per account: whatever this leaves
 * behind is what every later spec in the run sees. Two copies of this drifting
 * apart would be two different ways to strand the suite in a state it does not
 * expect, and the failure would surface in whichever file ran next rather than
 * in the one that caused it.
 *
 * Order matters on the way in. The connection has to be saved before the
 * typeahead switch exists at all — it is only offered where the *saved*
 * endpoint permits search-as-you-type — and lookup has to be on before that
 * switch is enabled.
 */
export async function setAddressLookup(
  page: Page,
  settings: { lookup: boolean; typeahead?: boolean; baseUrl?: string },
): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Places" }).click();
  const panel = page.locator("section").filter({ hasText: "Address lookup" });

  if (settings.lookup && settings.baseUrl) {
    await panel.getByLabel("Provider").selectOption("custom");
    await panel.getByLabel("Endpoint").fill(settings.baseUrl);
    await panel.getByRole("button", { name: "Save connection" }).click();
    // Portalled to the document root, so it is not inside `panel`.
    await page.getByText("Connection saved").waitFor();
  }

  // Switched on before off, so the typeahead switch is never asked to change
  // while it is disabled; switched off after, for the same reason in reverse.
  if (settings.lookup) await toggle(panel, "Use address lookup", true);
  await toggle(panel, "Suggest addresses as I type", settings.typeahead ?? false);
  if (!settings.lookup) await toggle(panel, "Use address lookup", false);
}

/**
 * Set one Radix switch, reading `aria-checked` rather than `isChecked()` —
 * these are buttons with `role="switch"`, not checkbox inputs.
 *
 * A switch that is not on the page is not an error: the typeahead one is only
 * rendered where the endpoint permits it, and asking for the state it already
 * has is a no-op everywhere.
 */
async function toggle(panel: Locator, name: string, on: boolean): Promise<void> {
  const control = panel.getByRole("switch", { name });
  if ((await control.count()) === 0) return;

  const want = on ? "true" : "false";
  if ((await control.getAttribute("aria-checked")) !== want) await control.click();
  await expect(control).toHaveAttribute("aria-checked", want);
}
