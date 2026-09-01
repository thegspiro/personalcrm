import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createContact, ensureSignedIn, openPrivacySettings } from "./helpers";

/**
 * The secondary lock, tested for what it actually has to do: withhold data.
 *
 * The important assertions here fetch the raw HTML rather than looking at the
 * screen. A hidden component would still have shipped the rows to the browser,
 * so "you can't see it" is not the same as "it isn't there".
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const PIN = "482913";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

const secretName = () => `Secret ${test.info().project.name} ${STAMP}`;

async function setCurrentUnlock(page: Page, unlockedAt: Date) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "pcrm_session",
  )?.value;
  if (!token)
    throw new Error("The browser has no authenticated session cookie.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.session.update({
    where: { tokenHash },
    data: { privacyUnlockedAt: unlockedAt },
  });
}

async function currentUnlock(page: Page) {
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "pcrm_session",
  )?.value;
  if (!token)
    throw new Error("The browser has no authenticated session cookie.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return prisma.session.findUniqueOrThrow({
    where: { tokenHash },
    select: { privacyUnlockedAt: true },
  });
}

test("set a PIN and switch the lock on", async ({ page }) => {
  await ensureSignedIn(page);
  await openPrivacySettings(page);

  // Be honest in the UI about what this protects against.
  await expect(page.getByText(/doesn't encrypt anything/i)).toBeVisible();

  // A previous run that stopped early can leave a PIN behind; start clean so
  // the suite is re-runnable against a live instance.
  if ((await page.getByText("PIN set").count()) > 0) {
    await page.getByLabel("Remove the PIN").fill(PIN);
    await page.getByRole("button", { name: "Remove PIN" }).click();
    await expect(page.getByText("PIN set")).toHaveCount(0);
  }

  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await page.getByLabel("Confirm").fill(PIN);
  await page.getByRole("button", { name: "Set PIN" }).click();
  await expect(page.getByText("PIN set")).toBeVisible();

  const requirePin = page.getByRole("switch", { name: /Require the PIN/ });
  if (!(await requirePin.isChecked())) await requirePin.click();
  await expect(requirePin).toBeChecked();
});

test("the lock cannot be disabled without the PIN, but its owner can disable it", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await openPrivacySettings(page);

  const requirePin = page.getByRole("switch", { name: /Require the PIN/ });
  await expect(requirePin).toBeChecked();
  await requirePin.click();

  // The switch alone does not lower the boundary. A fresh test session is
  // locked, so settings asks for proof rather than optimistically switching it
  // off in client state.
  await expect(requirePin).toBeChecked();
  await page.getByLabel("Current PIN", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Disable lock" }).click();
  await expect(page.getByText(/PIN is wrong/i)).toBeVisible();
  await expect(requirePin).toBeChecked();

  await page.getByLabel("Current PIN", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Disable lock" }).click();
  await expect(requirePin).not.toBeChecked();

  // Restore the suite's locked baseline for all following privacy checks.
  await requirePin.click();
  await expect(requirePin).toBeChecked();
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.waitForURL("/");
});

test("a private contact is withheld from the response while locked", async ({ page }) => {
  await ensureSignedIn(page);
  const name = secretName();
  const url = await createContact(page, name);

  // Each test gets a fresh session, so the lock starts closed. Marking
  // something private is itself a guarded write.
  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");

  await page.goto(url);
  await page.getByRole("button", { name: "Contact actions" }).click();
  await page.getByRole("menuitem", { name: "Mark private" }).click();
  await expect(page.getByText("Private", { exact: true })).toBeVisible();

  // Unlocked: they are in the list as normal.
  const beforeLock = await (await page.request.get("/people")).text();
  expect(beforeLock).toContain(name);

  await openPrivacySettings(page);
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.waitForURL("/");

  // Locked, checked three ways.
  //
  // The list is the strong one: the name must be absent from the raw HTML, so
  // the row genuinely never left the database rather than being hidden by a
  // component that renders nothing. Search and the detail page are asserted on
  // their rendered outcome instead, because a request's own URL and query are
  // echoed back into the router state and would look like a leak.
  const listHtml = await (await page.request.get("/people")).text();
  expect(listHtml).not.toContain(name);

  await page.goto(`/people?q=${encodeURIComponent(name)}`);
  await expect(page.getByText("No one matches")).toBeVisible();

  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Nothing here" }),
  ).toBeVisible();
});

test("a gift for a private contact is withheld from the gifts list while locked", async ({
  page,
}) => {
  // Regression: /gifts queried by owner alone, so a gift named the private
  // contact it was bought for and listed them while the lock was closed.
  await ensureSignedIn(page);
  const name = secretName();
  const url = await createContact(page, name);
  const gift = `Sable brush ${Date.now().toString(36)}`;

  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");

  await page.goto(url);
  await page.getByRole("button", { name: "Add a gift" }).click();
  await page.getByLabel("What is it?").fill(gift);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(gift)).toBeVisible();

  await page.getByRole("button", { name: "Contact actions" }).click();
  await page.getByRole("menuitem", { name: "Mark private" }).click();
  await expect(page.getByText("Private", { exact: true })).toBeVisible();

  expect(await (await page.request.get("/gifts")).text()).toContain(gift);

  await openPrivacySettings(page);
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.waitForURL("/");

  // Raw HTML, for the same reason the contact list is checked this way: the row
  // must never have left the database.
  const html = await (await page.request.get("/gifts")).text();
  expect(html).not.toContain(gift);
  expect(html).not.toContain(name);

  // Leave nothing private behind — a stray private contact switches offline
  // caching off account-wide and fails the next project for no reason.
  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");
  await page.goto(url);
  await page.getByRole("button", { name: "Contact actions" }).click();
  await page.getByRole("menuitem", { name: "Remove private mark" }).click();
  await expect(page.getByText("Private", { exact: true })).toHaveCount(0);
});

test("locked routes redirect to the unlock screen", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/dating");
  await expect(page).toHaveURL(/\/unlock/);
  await expect(page.getByRole("heading", { name: "Locked" })).toBeVisible();

  await page.goto("/dating/compare");
  await expect(page).toHaveURL(/\/unlock/);
});

test("the wrong PIN is rejected", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/unlock");
  await page.getByLabel("PIN").fill("000000");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/PIN is wrong/i)).toBeVisible();
});

test("the right PIN unlocks and returns you where you were headed", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/unlock?next=/dating");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();

  await page.waitForURL(/\/dating$/);
  await expect(
    page.getByRole("heading", { name: "Dating", level: 2 }),
  ).toBeVisible();
});

test("active protected use extends an unlock near its timeout", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/unlock?next=/dating");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL(/\/dating$/);

  const almostExpired = new Date(Date.now() - IDLE_TIMEOUT_MS + 20_000);
  await setCurrentUnlock(page, almostExpired);
  await page.goto("/dating");
  await expect(
    page.getByRole("heading", { name: "Dating", level: 2 }),
  ).toBeVisible();

  const session = await currentUnlock(page);
  expect(session.privacyUnlockedAt?.getTime()).toBeGreaterThan(
    almostExpired.getTime(),
  );
  expect(Date.now() - (session.privacyUnlockedAt?.getTime() ?? 0)).toBeLessThan(
    10_000,
  );
});

test("inactivity closes the shell and removes already-rendered dating content", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/unlock?next=/dating");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL(/\/dating$/);
  await expect(
    page.getByRole("heading", { name: "Dating", level: 2 }),
  ).toBeVisible();

  await page.clock.install({ time: new Date() });
  // Recreate the shell timer under Playwright's clock so fifteen minutes can
  // be exercised without making the suite sleep for fifteen real minutes.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Dating", level: 2 }),
  ).toBeVisible();
  await setCurrentUnlock(page, new Date(Date.now() - IDLE_TIMEOUT_MS));
  await page.clock.fastForward(IDLE_TIMEOUT_MS + 1);

  await expect(page.getByTestId("privacy-locked")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dating", level: 2 }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/unlock/);
});

test("a dating write already on screen is refused after server expiration", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");

  const url = await createContact(
    page,
    `Expiring ${test.info().project.name} ${STAMP}`,
  );
  await page.goto(`${url}/edit`);
  await page.getByText("Dating or interested").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(url);
  await page
    .getByLabel("Private notes")
    .fill("This write must not cross the deadline.");

  await setCurrentUnlock(page, new Date(Date.now() - IDLE_TIMEOUT_MS));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unlock with your PIN first.")).toBeVisible();
});

test("hiding the module removes it from navigation and blocks the route", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await openPrivacySettings(page);
  await page.getByRole("switch", { name: /Hide the dating module/ }).click();
  await expect(
    page.getByRole("switch", { name: /Hide the dating module/ }),
  ).toBeChecked();

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByRole("link", { name: "Dating" })).toHaveCount(0);
  await expect(page.getByTestId("widget-dating")).toHaveCount(0);

  await page.goto("/dating");
  await expect(page).toHaveURL("/");

  // Put it back: a test that leaves a global setting on becomes a trap for
  // everything that runs after it.
  await openPrivacySettings(page);
  await page.getByRole("switch", { name: /Hide the dating module/ }).click();
  await expect(
    page.getByRole("switch", { name: /Hide the dating module/ }),
  ).not.toBeChecked();
});

test("dating writes are refused while locked, not just hidden", async ({
  page,
}) => {
  await ensureSignedIn(page);

  // Server actions are ordinary POST endpoints. Gating the page alone would
  // leave the lock bypassable by anyone holding the session cookie, so the
  // action itself has to refuse.
  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");

  const name = `Guarded ${test.info().project.name} ${STAMP}`;
  const url = await createContact(page, name);
  await page.goto(`${url}/edit`);
  await page.getByText("Dating or interested").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(url);
  await expect(page.getByRole("button", { name: "Log a date" })).toBeVisible();

  // Close the lock, then confirm the write path is gone rather than merely
  // invisible: the section is not rendered at all.
  await openPrivacySettings(page);
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.waitForURL("/");

  await page.goto(url);
  await expect(page.getByRole("button", { name: "Log a date" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a flag" })).toHaveCount(0);

  // And the contact's own page carries no dating data in its HTML.
  const html = await (await page.request.get(url)).text();
  expect(html).not.toContain("Private notes");
});

test("the header offers a way to close the lock without waiting out the timeout", async ({
  page,
}) => {
  await ensureSignedIn(page);

  // Arrives here with the lock closed, which is the state the control must not
  // appear in: nothing is open, so there is nothing to close.
  await page.goto("/");
  const lockNow = page.getByRole("button", { name: "Lock private content now" });
  await expect(lockNow).toHaveCount(0);

  await page.goto("/unlock?next=/");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("/");

  // Now it is the one visible sign that private content is open at all.
  await expect(lockNow).toBeVisible();

  // A lock that cannot reach the server must not put the page back. A lost
  // response and a lost request are indistinguishable from the browser, so
  // restoring would risk showing private content for a session the server has
  // already locked. The shell stays closed and offers a reload instead.
  await page.context().setOffline(true);
  await lockNow.click();
  // Announced, not merely rendered: blanking the shell takes focus with it, so
  // an unannounced swap leaves a screen-reader user with no idea the lock they
  // asked for did not happen.
  // Scoped: Next's route announcer is also role="alert".
  const failure = page.getByTestId("privacy-locked").getByRole("alert");
  await expect(failure).toContainText(/Could not confirm the lock closed/i);
  await expect(failure).toBeFocused();
  await expect(lockNow).toHaveCount(0);

  // The reload re-reads the truth from the server. Nothing committed here, so
  // it comes back unlocked -- and that is the server saying so, not the
  // browser assuming it.
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(lockNow).toBeVisible();
  await lockNow.click();

  // Locking from "/" is the case a soft navigation cannot serve: the
  // controller lives in the app layout and survives client routing, so
  // `router.replace` to the route already showing would leave the viewer on
  // the blank panel for good. Assert a usable page comes back, before any
  // navigation of the test's own that would paper over it.
  await expect(page.getByText("Privacy lock closed.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  // The lock really closed, rather than the button only changing appearance.
  await expect(lockNow).toHaveCount(0);
  await page.goto("/dating");
  await expect(page).toHaveURL(/\/unlock/);

  // Leaves the suite locked, which is how it was found.
});

test("cleaning up: unhide, unmark, and remove the PIN", async ({ page }) => {
  await ensureSignedIn(page);
  await openPrivacySettings(page);

  await page.getByLabel("Remove the PIN").fill(PIN);
  await page.getByRole("button", { name: "Remove PIN" }).click();
  await expect(page.getByText("PIN set")).toHaveCount(0);

  // Unmark the contact too. A private contact left behind is not just untidy —
  // it switches offline caching off for the whole account, so the next
  // project's offline tests would fail for a reason that has nothing to do
  // with them.
  await page.goto(`/people?q=${encodeURIComponent(secretName())}`);
  const link = page.getByRole("link", { name: new RegExp(secretName()) });
  if ((await link.count()) > 0) {
    await link.first().click();
    await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);
    const url = page.url();
    await page.getByRole("button", { name: "Contact actions" }).click();
    const posted = page.waitForResponse(
      (response) => response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByRole("menuitem", { name: "Remove private mark" }).click();
    await posted.catch(() => {});
    await expect
      .poll(
        async () => {
          await page.goto(url);
          return page.getByText("Private", { exact: true }).count();
        },
        { timeout: 15_000 },
      )
      .toBe(0);
  }

  // With no PIN the lock is off, so dating is reachable again.
  await page.goto("/dating");
  await expect(page).toHaveURL(/\/dating$/);
});
