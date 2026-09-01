"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  lockPrivacyNow,
  privacyActivityHeartbeat,
} from "@/server/actions/privacy";
import { purgeOfflineCaches } from "@/components/offline/offline";

/**
 * Lets a descendant ask for the lock to close now rather than at the deadline.
 *
 * The request has to come back here because closing means unmounting the
 * shell: a control rendered inside it cannot remove the tree it lives in, and
 * an overlay drawn over that tree only hides it from people who are looking --
 * the content stays in the accessibility tree and keyboard-reachable.
 */
const ManualLockContext = React.createContext<{
  lockNow: () => void;
  locking: boolean;
} | null>(null);

export function useManualPrivacyLock() {
  return React.useContext(ManualLockContext);
}

type Props = {
  enabled: boolean;
  unlocked: boolean;
  expiresAt: number | null;
  idleTimeoutMs: number;
  heartbeatMs: number;
  children: React.ReactNode;
};

/**
 * Mirrors the server-owned deadline in the authenticated shell. Browser input
 * is only a reason to ask the server for a throttled extension; it is never
 * authorization. When the deadline closes, children are synchronously removed
 * before caches are purged and navigation asks the server for locked content.
 */
export function PrivacyActivityController({
  enabled,
  unlocked,
  expiresAt,
  idleTimeoutMs,
  heartbeatMs,
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deadline, setDeadline] = React.useState(expiresAt);
  // Only a deadline that closes while this shell is open blanks it. Starting
  // closed because the session is merely locked would wall off every route,
  // with no redirect -- close() is what navigates -- and Settings has to stay
  // reachable while locked so the PIN can be entered to disable the lock at
  // all. A locked server render is already safe: privacy is enforced in the
  // queries, so the content was never sent.
  const [closed, setClosed] = React.useState(false);
  const lastHeartbeat = React.useRef(expiresAt ? expiresAt - idleTimeoutMs : 0);
  const pendingActivity = React.useRef(false);
  const heartbeatTimer = React.useRef<number | null>(null);
  const heartbeatInFlight = React.useRef(false);

  const close = React.useCallback(() => {
    setClosed(true);
    setDeadline(null);
    if (heartbeatTimer.current !== null)
      window.clearTimeout(heartbeatTimer.current);
    heartbeatTimer.current = null;
    pendingActivity.current = false;

    void purgeOfflineCaches().finally(() => {
      const query = searchParams.toString();
      const next = `${pathname}${query ? `?${query}` : ""}`;
      router.replace(`/unlock?next=${encodeURIComponent(next)}`);
      router.refresh();
    });
  }, [pathname, router, searchParams]);

  const [locking, setLocking] = React.useState(false);
  const [lockFailed, setLockFailed] = React.useState(false);

  /**
   * The deliberate version of `close`: the timeout covers walking away, this
   * covers handing someone your phone. Blanking first is the point -- the
   * private content is out of the DOM before any awaiting starts, so it is
   * gone for a screen reader and for the tab key too, not merely covered.
   */
  const lockNow = React.useCallback(() => {
    if (locking) return;
    setLocking(true);
    setClosed(true);

    void (async () => {
      // Both start now rather than in sequence. Posting the purge immediately
      // hands it to the service worker, whose `waitUntil` finishes on its own
      // even if this document goes away mid-flight; awaiting the lock first
      // would leave a cached private page behind when it does.
      const purged = purgeOfflineCaches();
      const locked = lockPrivacyNow().catch(() => null);

      const result = await locked;
      await purged;

      if (!result?.ok) {
        // Deliberately does not restore the shell. A lost response and a lost
        // request look identical from here, and if the write did commit,
        // remounting would put the already-rendered private tree back on
        // screen for a session the server now considers locked. A reload is
        // the way back, because it re-reads the truth from the server.
        setLockFailed(true);
        setLocking(false);
        return;
      }

      // A full document navigation, not `router.replace`. This component lives
      // in the app layout and survives client routing, so a soft navigation --
      // to the current route especially -- keeps `closed` true and strands the
      // viewer on the blank panel. Reloading also guarantees the next render
      // comes from the now-locked server rather than anything held in memory.
      // The rule below advises `router.push`, which is the soft navigation
      // this is deliberately avoiding.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    })();
  }, [locking]);

  React.useEffect(() => {
    if (!enabled || !unlocked || !deadline || closed) return;

    const timeout = window.setTimeout(
      close,
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [close, closed, deadline, enabled, unlocked]);

  React.useEffect(() => {
    if (!enabled || !unlocked || !deadline || closed) return;

    const sendHeartbeat = async () => {
      heartbeatTimer.current = null;
      if (
        !pendingActivity.current ||
        heartbeatInFlight.current ||
        Date.now() >= deadline
      )
        return;
      pendingActivity.current = false;
      heartbeatInFlight.current = true;
      try {
        const result = await privacyActivityHeartbeat();
        if (!result.ok) {
          close();
          return;
        }
        lastHeartbeat.current = result.expiresAt - idleTimeoutMs;
        setDeadline(result.expiresAt);
      } finally {
        heartbeatInFlight.current = false;
      }
    };

    const onActivity = () => {
      if (document.visibilityState === "hidden" || Date.now() >= deadline)
        return;
      pendingActivity.current = true;
      if (heartbeatTimer.current !== null) return;
      const delay = Math.max(
        0,
        lastHeartbeat.current + heartbeatMs - Date.now(),
      );
      heartbeatTimer.current = window.setTimeout(
        () => void sendHeartbeat(),
        delay,
      );
    };

    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    for (const event of events)
      window.addEventListener(event, onActivity, { passive: true });
    window.addEventListener("focus", onActivity);
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
      window.removeEventListener("focus", onActivity);
      if (heartbeatTimer.current !== null)
        window.clearTimeout(heartbeatTimer.current);
      heartbeatTimer.current = null;
    };
  }, [close, closed, deadline, enabled, heartbeatMs, idleTimeoutMs, unlocked]);

  if (closed) {
    return (
      <main
        className="grid min-h-dvh place-items-center bg-background"
        data-testid="privacy-locked"
      >
        {lockFailed ? (
          <div className="grid justify-items-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Could not confirm the lock closed. Reload to see where things
              stand.
            </p>
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Privacy lock closed.</p>
        )}
      </main>
    );
  }

  return (
    <ManualLockContext.Provider value={{ lockNow, locking }}>
      {children}
    </ManualLockContext.Provider>
  );
}
