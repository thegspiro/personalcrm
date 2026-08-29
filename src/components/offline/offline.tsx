"use client";

import * as React from "react";
import { CloudOff } from "lucide-react";
import { toast } from "sonner";


/**
 * Offline reading, from the page's side.
 *
 * Three small pieces: registering the worker, letting a page say it is safe to
 * store, and telling you when what you are looking at is old.
 */

export type WorkerUpdateState = "idle" | "installing" | "waiting" | "activating";

type WorkerSnapshot = {
  update: WorkerUpdateState;
  failures: number;
};

const listeners = new Set<() => void>();
let snapshot: WorkerSnapshot = { update: "idle", failures: 0 };
const serverSnapshot: WorkerSnapshot = { update: "idle", failures: 0 };
let retainedRegistration: ServiceWorkerRegistration | null = null;

export function reduceWorkerSnapshot(
  current: WorkerSnapshot,
  event: "installing" | "installed" | "activate" | "activated" | "failed",
): WorkerSnapshot {
  if (event === "failed") return { update: "idle", failures: current.failures + 1 };
  if (event === "installing") return { ...current, update: "installing" };
  if (event === "installed") return { ...current, update: "waiting" };
  if (event === "activate") return { ...current, update: "activating" };
  return { ...current, update: "idle", failures: 0 };
}

function publish(event: Parameters<typeof reduceWorkerSnapshot>[1]) {
  snapshot = reduceWorkerSnapshot(snapshot, event);
  listeners.forEach((listener) => listener());
}

function observeInstalling(registration: ServiceWorkerRegistration) {
  const worker = registration.installing;
  if (!worker) return;
  publish("installing");
  const statechange = () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) publish("installed");
    // register() can resolve even though fetching or evaluating an updated
    // worker later fails. Browsers report that case by making the installing
    // worker redundant, so it must feed the same failure warning as a rejected
    // registration rather than leaving the UI stuck on "installing".
    if (worker.state === "redundant") publish("failed");
  };
  worker.addEventListener("statechange", statechange);
}

/** Registers the worker and retains its lifecycle for the update UI. */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (cancelled) return;
        retainedRegistration = registration;
        snapshot = { ...snapshot, failures: 0 };
        if (registration.waiting && navigator.serviceWorker.controller) publish("installed");
        observeInstalling(registration);
        registration.addEventListener("updatefound", () => observeInstalling(registration));
      }).catch(() => {
        if (cancelled) return;
        publish("failed");
        if (snapshot.failures < 3) retry = setTimeout(register, 1_000);
      });
    };
    register();

    const controllerchange = () => {
      publish("activated");
      if (reloadOnControllerChange) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", controllerchange);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerchange);
    };
  }, []);

  return null;
}

const PURGE_ACK_TIMEOUT_MS = 2_000;

/** Delete this application's caches without relying on a worker. */
async function deleteOfflineCachesFromPage(): Promise<void> {
  if (typeof caches === "undefined") return;

  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("pcrm-")).map((name) => caches.delete(name)),
    );
  } catch {
    // Blocked Cache Storage is equivalent to there being nothing we can keep.
  }
}

/** Tell the worker to throw everything away and wait until it confirms that it has. */
export async function purgeOfflineCaches(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    await deleteOfflineCachesFromPage();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active ?? navigator.serviceWorker.controller;
    if (!worker) {
      await deleteOfflineCachesFromPage();
      return;
    }

    const acknowledged = await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const finish = (value: boolean) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(value);
      };
      const timeout = window.setTimeout(() => finish(false), PURGE_ACK_TIMEOUT_MS);
      channel.port1.onmessage = () => finish(true);
      channel.port1.onmessageerror = () => finish(false);

      try {
        worker.postMessage({ type: "purge" }, [channel.port2]);
      } catch {
        finish(false);
      }
    });

    if (!acknowledged) await deleteOfflineCachesFromPage();
  } catch {
    await deleteOfflineCachesFromPage();
  }
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
  const [disconnected, setDisconnected] = React.useState(false);
  const [savedCopy, setSavedCopy] = React.useState(false);
  const [age, setAge] = React.useState("just now");

  React.useEffect(() => {
    const update = () => {
      setDisconnected(!navigator.onLine);
      setAge(howLongAgo(new Date(renderedAt)));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // A copy gets staler while you look at it, so the number has to move.
    const timer = setInterval(update, 30_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(timer);
    };
  }, [renderedAt]);

  /**
   * The worker's word for it, which beats navigator.onLine.
   *
   * A document loaded offline is the worst-placed thing in the browser to work
   * out that it was: the online/offline events it would learn from fired
   * before it existed, so all it has is one read of navigator.onLine at mount,
   * and if that read is wrong the page presents a saved copy as though it were
   * live. The worker served the copy and is never wrong about it.
   *
   * Asked rather than listened for. A message the worker posts while serving
   * the response arrives before this component exists, and a listener added
   * afterwards never receives it — `startMessages()` does not replay what has
   * already been dispatched.
   *
   * Sticky on purpose. Getting the network back does not make what you are
   * looking at any less of a saved copy — nothing has re-fetched it — so
   * dropping the warning then would be the same lie told later.
   */
  React.useEffect(() => {
    const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
    if (!worker) return;

    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      if ((event.data as { servedFromCache?: boolean } | null)?.servedFromCache) setSavedCopy(true);
    };
    // No hash: the worker only ever saw what was sent to the server.
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    worker.postMessage({ type: "was-served-from-cache", url }, [channel.port2]);

    return () => channel.port1.close();
  }, []);

  if (!disconnected && !savedCopy) return null;

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
