import { expect, test, type Page } from "@playwright/test";
import { createContact, ensureSignedIn, openPrivacySettings } from "./helpers";

/**
 * Installability and offline reading.
 *
 * The interesting assertions are about what is *not* stored. Caching is off by
 * default and pages opt in, so the tests that matter check that a page
 * carrying anything private never asks.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const SECRET = () => `Confidential ${test.info().project.name} ${STAMP}`;
const PIN = "713904";

/** Wait for the worker to be running before asking it anything. */
async function readyWorker(page: Page) {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active);
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** Pages currently kept for offline reading. */
async function cachedPages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const pages = names.filter((name) => name.startsWith("pcrm-pages"));
    const out: string[] = [];
    for (const name of pages) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) out.push(new URL(request.url).pathname);
    }
    return out;
  });
}

/**
 * Toggle the private marker and wait for it to actually stick.
 *
 * The header badge is the signal — a toast has usually gone by the time it is
 * asserted on, and reopening the dropdown to read its label is fiddlier than
 * just reloading.
 */
async function setPrivateMark(page: Page, url: string, wanted: boolean) {
  await page.goto(url);
  await page.getByRole("button", { name: "Contact actions" }).click();

  // The menu fires the action without awaiting it, so wait for the POST to
  // land — navigating away first aborts it and the mark never sticks.
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(url.split("?")[0].replace(/^https?:\/\/[^/]+/, "")),
    { timeout: 15_000 },
  );
  await page.getByRole("menuitem", { name: wanted ? "Mark private" : "Remove private mark" }).click();
  await posted.catch(() => {});

  await expect
    .poll(
      async () => {
        await page.goto(url);
        return page.getByText("Private", { exact: true }).count();
      },
      { timeout: 15_000 },
    )
    .toBe(wanted ? 1 : 0);
}

async function clearPageCache(page: Page) {
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("pcrm-pages")) await caches.delete(name);
    }
  });
}

/**
 * Make sure the lock is off before anything that writes.
 *
 * A run that stops early can leave a PIN behind, and every new browser context
 * starts locked — which makes `setPrivate` refuse and this whole file fail for
 * a reason that has nothing to do with offline reading.
 */
async function ensureUnlocked(page: Page) {
  const unlockScreen = await page.goto("/unlock");
  if (unlockScreen && new URL(page.url()).pathname === "/unlock") {
    await page.getByLabel(/PIN/).fill(PIN);
    await page.getByRole("button", { name: /Unlock/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/unlock"));
  }

  await openPrivacySettings(page);
  if ((await page.getByText("PIN set").count()) > 0) {
    await page.getByLabel("Remove the PIN").fill(PIN);
    await page.getByRole("button", { name: "Remove PIN" }).click();
    await expect(page.getByText("PIN set")).toHaveCount(0);
  }
}

test("the app is installable", async ({ page }) => {
  await ensureSignedIn(page);
  await ensureUnlocked(page);

  // Phase 1 advertised a manifest and shipped nothing, so this was a 404 on
  // every page load until now.
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.display).toBe("standalone");
  expect(body.icons.length).toBeGreaterThan(0);

  const icon = await page.request.get("/icon");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
});

test("visited pages become readable offline", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await readyWorker(page);
  await page.goto("/people");

  await expect
    .poll(() => cachedPages(page), { timeout: 15_000 })
    .toContain("/people");
});

test("an offline page says how old it is", async ({ page, context }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await readyWorker(page);
  await page.goto("/people");
  await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain("/people");

  await context.setOffline(true);
  await page.goto("/people", { waitUntil: "domcontentloaded" });

  // Stale data that looks live is the real danger here, so it has to say so.
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await expect(page.getByText(/saved copy/)).toBeVisible();
  // And the content is genuinely there, not a placeholder.
  await expect(page.getByRole("heading", { name: "People", level: 2 })).toBeVisible();

  await context.setOffline(false);
});

test("a page that was never saved says so rather than pretending", async ({ page, context }) => {
  await ensureSignedIn(page);
  await page.goto("/");
  await readyWorker(page);
  await clearPageCache(page);

  await context.setOffline(true);
  await page.goto("/gifts", { waitUntil: "domcontentloaded" }).catch(() => {});
  await expect(page.getByText(/isn't saved for offline reading/i)).toBeVisible();

  await context.setOffline(false);
});

test("nothing is stored once anyone is marked private", async ({ page }) => {
  await ensureSignedIn(page);
  const url = await createContact(page, SECRET());

  await page.goto("/people");
  await readyWorker(page);
  await clearPageCache(page);

  // Before: an ordinary account keeps pages.
  await page.goto("/people");
  await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain("/people");

  await setPrivateMark(page, url, true);

  await clearPageCache(page);

  // After: one private person and the whole account stops being cacheable.
  // A stale copy is an inconvenience; a private note written to disk is the
  // thing the lock exists to prevent.
  await page.goto("/people");
  await page.waitForTimeout(3_000);
  expect(await cachedPages(page)).toEqual([]);

  await page.goto(url);
  await page.waitForTimeout(3_000);
  expect(await cachedPages(page)).toEqual([]);
});

test("cleaning up: unmark the private contact", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(`/people?q=${encodeURIComponent(SECRET())}`);
  await page.getByRole("link", { name: new RegExp(SECRET()) }).first().click();
  await page.waitForURL(/\/people\/[a-z0-9]{20,}$/);

  await setPrivateMark(page, page.url(), false);
});

test("locking throws the saved pages away", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await readyWorker(page);
  await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain("/people");

  await openPrivacySettings(page);
  if ((await page.getByText("PIN set").count()) === 0) {
    await page.getByLabel("PIN", { exact: true }).fill(PIN);
    await page.getByLabel("Confirm").fill(PIN);
    await page.getByRole("button", { name: "Set PIN" }).click();
    await expect(page.getByText("PIN set")).toBeVisible();
  }
  const requirePin = page.getByRole("switch", { name: /Require the PIN/ });
  if (!(await requirePin.isChecked())) await requirePin.click();

  await page.getByRole("button", { name: /Lock now/i }).click();
  await page.waitForTimeout(2_000);

  // A saved copy of a page seen while unlocked would make the lock decorative,
  // so everything from before is gone. Pages visited *after* locking may be
  // saved again and that is correct: while locked, every query has already
  // excluded private rows, so what lands on disk is exactly what someone
  // holding the phone could see anyway.
  expect(await cachedPages(page)).not.toContain("/people");

  // Put it back so the rest of the suite is unaffected.
  await page.goto("/unlock");
  await page.getByLabel(/PIN/).fill(PIN);
  await page.getByRole("button", { name: /Unlock/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/unlock"));
  await openPrivacySettings(page);
  await page.getByLabel("Remove the PIN").fill(PIN);
  await page.getByRole("button", { name: "Remove PIN" }).click();
  await expect(page.getByText("PIN set")).toHaveCount(0);
});
