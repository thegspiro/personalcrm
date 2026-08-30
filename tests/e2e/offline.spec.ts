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

/**
 * Wait for the worker to be running AND for it to control this page.
 *
 * These are not the same thing, and the difference is the whole test. A
 * registration becomes active without controlling the document that registered
 * it — control is only taken on a navigation after activation. Caching still
 * works meanwhile, because the page asks through `registration.active`, which
 * needs no controller; so waiting for an active registration and a populated
 * cache can both succeed while nothing is intercepting fetches.
 *
 * Go offline in that state and the navigation never reaches the worker at all:
 * the browser shows its own ERR_INTERNET_DISCONNECTED page, and the assertion
 * that fails is the one about the offline banner. It passes on a fast machine,
 * where `clients.claim()` wins the race, and fails on a slower CI runner.
 */
async function readyWorker(page: Page) {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active);
    },
    undefined,
    { timeout: 15_000 },
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) return;
    await page.reload();
  }

  throw new Error("the service worker activated but never took control of the page");
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

test("the additional read-only routes opt into the offline page cache", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/tasks");
  await readyWorker(page);
  await clearPageCache(page);

  // The /people scenario below exercises an actual disconnected navigation
  // and stale-page banner. Each named step here proves the corresponding
  // server component rendered CacheThisPage without paying for a fresh browser
  // context and service-worker installation per route on CI.
  for (const route of ["/tasks", "/gifts", "/ideas", "/family"]) {
    await test.step(`${route} opts in`, async () => {
      await page.goto(route);
      await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain(route);
    });
  }
});

test("a worker update removes an old page and its assets together", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await readyWorker(page);

  // Model the two halves of a previous deployment. The HTML deliberately
  // names an asset that exists only in that generation: preserving the page
  // while deleting the asset would reproduce the broken offline update.
  await page.evaluate(async () => {
    const oldPages = await caches.open("pcrm-pages-e2e-old");
    const oldAssets = await caches.open("pcrm-assets-e2e-old");
    await oldPages.put(
      "/e2e-old-page",
      new Response('<!doctype html><script src="/_next/static/e2e-old.js"></script>', {
        headers: { "Content-Type": "text/html" },
      }),
    );
    await oldAssets.put("/_next/static/e2e-old.js", new Response("window.oldGeneration = true"));
  });

  // A distinct script URL makes the browser install and activate a fresh
  // worker even though this test server still serves the same sw.js contents.
  // Unregistering models replacement rather than waiting for a real deploy.
  await page.evaluate(async () => {
    const oldRegistration = await navigator.serviceWorker.getRegistration();
    await oldRegistration?.unregister();
    const nextRegistration = await navigator.serviceWorker.register(`/sw.js?e2e-version=${Date.now()}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("updated worker did not activate")), 15_000);
      const finish = () => {
        if (!nextRegistration.active) return;
        window.clearTimeout(timeout);
        resolve();
      };
      if (nextRegistration.active) finish();
      else if (nextRegistration.installing) nextRegistration.installing.addEventListener("statechange", finish);
      else nextRegistration.addEventListener("updatefound", () => nextRegistration.installing?.addEventListener("statechange", finish));
    });
  });

  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).filter((name) => name.includes("e2e-old"))))
    .toEqual([]);
});

test("an offline page says how old it is", async ({ page, context }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await readyWorker(page);
  await page.goto("/people");
  await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain("/people");

  await context.setOffline(true);
  await page.goto("/people", { waitUntil: "domcontentloaded" });

  // The saved page first, then what it says about itself. Two very different
  // failures both show up as "no offline banner": the worker served the saved
  // copy and the banner did not render, or the navigation never reached the
  // worker at all and this is the browser's own error page. Asserting the
  // content first is what tells them apart from a CI log alone.
  await expect(page.getByRole("heading", { name: "People", level: 2 })).toBeVisible();

  // Stale data that looks live is the real danger here, so it has to say so.
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await expect(page.getByText(/saved copy/)).toBeVisible();

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

  // Every read-only route uses the same account-wide gate. None may opt in
  // merely because its own result happens not to mention the private person.
  for (const route of ["/tasks", "/gifts", "/ideas", "/family"]) {
    await page.goto(route);
    // CacheThisPage posts after 800ms. Wait beyond that boundary before
    // asserting absence, otherwise this test can pass just before a bad opt-in.
    await page.waitForTimeout(2_000);
    expect(await cachedPages(page)).toEqual([]);
  }
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
