"use client";

import * as React from "react";
import { CloudOff } from "lucide-react";


/**
 * Offline reading, from the page's side.
 *
 * Three small pieces: registering the worker, letting a page say it is safe to
 * store, and telling you when what you are looking at is old.
 */

/** Registers the worker, and wipes its caches when the session ends. */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A blocked or unsupported worker just means no offline reading. The app
      // works exactly as it did before.
    });
  }, []);

  return null;
}

/** Tell the worker to throw everything away. */
export function purgeOfflineCaches(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: "purge" }))
    .catch(() => {});
}

/**
 * Marks the current page as safe to keep for offline reading.
 *
 * Rendered only by pages that carry nothing sensitive. Caching is off by
 * default and this is the only thing that turns it on for a URL, so a page
 * showing a private contact simply never renders it — no URL patterns to
 * maintain and no way for a missed one to write private notes to disk.
 */
export function CacheThisPage() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const url = window.location.pathname + window.location.search;
    const timer = setTimeout(() => {
      void navigator.serviceWorker.ready
        .then((registration) => registration.active?.postMessage({ type: "cache-page", url }))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

/**
 * How long ago, to the minute.
 *
 * `relativeInstant` in src/lib/format.ts is day-granular — "Today",
 * "Yesterday" — which is right for a timeline and useless for staleness. Ten
 * minutes and twenty hours are both "Today", and only one of them matters.
 */
export function howLongAgo(then: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "just now";

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];

  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0];
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit;
  }
  return format.format(-Math.round(seconds / chosen[1]), chosen[0]);
}

/**
 * Says so when you are reading a saved copy.
 *
 * Stale data that looks live is the real danger of offline reading — a cadence
 * worked out from a week-old copy will tell you someone is fine when they are
 * not. The page carries the moment it was rendered, and this says how long ago
 * that was.
 */
export function OfflineBanner({ renderedAt }: { renderedAt: string }) {
  const [offline, setOffline] = React.useState(false);
  const [age, setAge] = React.useState("just now");

  React.useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      setAge(howLongAgo(new Date(renderedAt)));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Two things need re-checking, and the more urgent one sets the pace.
    //
    // The age only has to move often enough to stay honest to the minute. But
    // `offline` comes from a single read of navigator.onLine on mount, and a
    // document that was *loaded* offline never receives the online/offline
    // events — they fired before it existed. So if that one read is wrong, the
    // page goes on claiming to be live, which is precisely the stale-data-
    // looking-live problem this banner exists to prevent. A second is soon
    // enough to matter and costs nothing: both setState calls bail out when the
    // value has not changed, so a page that is simply online never re-renders.
    const timer = setInterval(update, 1_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(timer);
    };
  }, [renderedAt]);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="mb-4 flex min-w-0 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      <CloudOff className="size-4 shrink-0" />
      <span className="min-w-0">
        You&apos;re offline — this is a saved copy from{" "}
        <span className="font-medium">{age}</span>. Anything newer isn&apos;t here, and you
        can&apos;t change anything until you reconnect.
      </span>
    </div>
  );
}
