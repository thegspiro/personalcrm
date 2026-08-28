/**
 * Offline reading.
 *
 * Two rules shape everything here:
 *
 *  1. **Nothing is cached unless a page says so.** The default is not to
 *     store, and pages opt in by posting `cache-page` after they render. A
 *     page showing a private contact, anything under /dating, and every form
 *     and settings screen simply never asks. Guessing from URLs would mean one
 *     missed pattern quietly writes someone's private notes to disk.
 *  2. **Locking or signing out wipes it.** The privacy lock is worth nothing
 *     if yesterday's copy of a locked page is still sitting in the cache.
 *  3. **A worker generation is one page/asset unit.** On activation, obsolete
 *     page caches are deleted before their matching asset caches. This is the
 *     deliberate "cold offline after an update" strategy: no old document is
 *     retained after the assets named by that document can disappear. Pages
 *     become offline-capable again as they are revisited and opt in.
 *
 * This worker never queues writes. Everything non-GET goes straight to the
 * network and fails honestly when there isn't one.
 */

const VERSION = "v1";

/**
 * URLs this worker has served from the page cache, waiting to be asked about.
 *
 * Only the worker knows whether a document came off the disk or the network,
 * and the document itself is the worst-placed thing to guess: the
 * online/offline events it would learn from fired before it existed, leaving
 * it one read of navigator.onLine that can simply be wrong.
 *
 * Answered on request rather than pushed. A message posted before the page has
 * a listener is not replayed to one added later, and the page's listener
 * necessarily arrives after hydration — long after the response was served.
 */
const servedFromCache = new Set();
const PAGES = `pcrm-pages-${VERSION}`;
const ASSETS = `pcrm-assets-${VERSION}`;
const OURS = [PAGES, ASSETS];

self.addEventListener("install", (event) => {
  // An update waits until the page explicitly accepts it. A first install has
  // no incumbent worker and proceeds to activation normally.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await purgeObsoleteGenerations();
      await self.clients.claim();
    })(),
  );
});

/**
 * Remove an obsolete generation as a page/asset unit.
 *
 * Cache Storage has no multi-cache transaction. Deleting old documents first
 * gives the operation the one safe ordering: interruption can leave harmless
 * orphaned assets, but can never leave an old cached document after its asset
 * generation has been removed. Do not parallelize these two phases.
 */
async function purgeObsoleteGenerations() {
  const obsolete = (await caches.keys()).filter((name) => name.startsWith("pcrm-") && !OURS.includes(name));
  const pages = obsolete.filter((name) => name.startsWith("pcrm-pages-"));
  const assetsAndUnknown = obsolete.filter((name) => !pages.includes(name));

  await Promise.all(pages.map((name) => caches.delete(name)));
  await Promise.all(assetsAndUnknown.map((name) => caches.delete(name)));
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "cache-page" && typeof data.url === "string") {
    event.waitUntil(cachePage(data.url));
  } else if (data.type === "was-served-from-cache" && typeof data.url === "string") {
    // Asked once, on mount, by the offline banner. Consumed as it is read: the
    // answer is about this document's own navigation, not the URL forever.
    const answer = servedFromCache.has(data.url);
    servedFromCache.delete(data.url);
    event.ports[0]?.postMessage({ servedFromCache: answer });
  } else if (data.type === "purge") {
    // Sent on lock and on sign-out. Everything goes, including the shell.
    event.waitUntil(purgeEverything());
  } else if (data.type === "activate-update") {
    self.skipWaiting();
  }
});

/**
 * Fetch a page fresh and store it.
 *
 * Done on the page's say-so rather than by intercepting its own response, so
 * the decision to store is always the server's rather than a guess made here.
 */
async function cachePage(url) {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return;
    // A redirect means we were bounced — to /login or /unlock — and storing
    // that under the original URL would show the wrong page offline.
    if (response.redirected) return;

    const cache = await caches.open(PAGES);
    await cache.put(url, response.clone());
  } catch {
    // Offline, or the request failed. Nothing to store; not an error.
  }
}

async function purgeEverything() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith("pcrm-")).map((name) => caches.delete(name)));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Writes are never queued or replayed. If there is no network, the app says
  // so rather than pretending something was saved.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch these. Auth and the unlock screen must always be live, and an
  // RSC payload cached under a page URL would be served in place of the HTML.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login" ||
    url.pathname === "/unlock" ||
    url.pathname === "/setup" ||
    url.pathname === "/signup" ||
    url.pathname === "/welcome" ||
    url.searchParams.has("_rsc")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon") {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Live page when there is a network, the stored copy when there isn't.
 *
 * Network-first rather than cache-first because a stale contact is actively
 * misleading — a cadence that says "due in 3 days" from a week-old copy is
 * worse than a spinner. The cache is a fallback, not a speed-up.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Only refresh what is already stored. A page that never opted in does not
    // get cached just because you happened to visit it.
    if (response.ok && !response.redirected) {
      const cache = await caches.open(PAGES);
      const existing = await cache.match(request.url);
      if (existing) await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request.url);
    if (cached) {
      servedFromCache.add(request.url);
      return cached;
    }

    const shell = await caches.match("/offline");
    if (shell) return shell;

    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
        "<title>Offline</title>" +
        "<body style=\"font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100dvh;background:#fafafa;color:#0f1115\">" +
        "<div style=\"text-align:center;padding:2rem\"><h1 style=\"font-size:1.125rem;margin:0 0 .5rem\">You're offline</h1>" +
        "<p style=\"font-size:.875rem;color:#666;margin:0\">This page isn't saved for offline reading.</p></div>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request.url);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(request.url, response.clone());
  }
  return response;
}
