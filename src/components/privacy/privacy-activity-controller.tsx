"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  lockPrivacyAction,
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
      try {
        // Caches before the action: `lockPrivacyAction` redirects, so anything
        // sequenced after it may never run, and private pages the service
        // worker wrote to disk would outlive the lock they were cached under.
        await purgeOfflineCaches();
        await lockPrivacyAction();
      } catch (error) {
        // A redirecting server action reports itself by throwing a digest.
        // That is the success path, so hold the blank shell for the
        // navigation rather than restoring the page behind it.
        const digest = (error as { digest?: unknown } | null)?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return;

        // Anything else and the lock did not close. Give the app back rather
        // than stranding the viewer on a blank screen -- worst offline, where
        // the request cannot land and the cache has already been purged.
        setClosed(false);
        setLocking(false);
        toast.error("Could not lock. Check your connection and try again.");
      }
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
        <p className="text-sm text-muted-foreground">Privacy lock closed.</p>
      </main>
    );
  }

  return (
    <ManualLockContext.Provider value={{ lockNow, locking }}>
      {children}
    </ManualLockContext.Provider>
  );
}
