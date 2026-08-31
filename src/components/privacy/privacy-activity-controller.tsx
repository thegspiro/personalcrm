"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { privacyActivityHeartbeat } from "@/server/actions/privacy";
import { purgeOfflineCaches } from "@/components/offline/offline";

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

  return <>{children}</>;
}
