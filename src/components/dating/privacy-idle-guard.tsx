"use client";

import * as React from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { purgeOfflineCaches } from "@/components/offline/offline";
import { lockPrivacyAction, touchPrivacyAction } from "@/server/actions/privacy";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

/** Promptly removes rendered private content; the server remains authoritative. */
export function PrivacyIdleGuard({ unlockedUntilMs }: { unlockedUntilMs: number | null }) {
  const [locking, setLocking] = React.useState(false);
  const lastActivity = React.useRef(0);
  const lastHeartbeat = React.useRef(unlockedUntilMs ? unlockedUntilMs - IDLE_TIMEOUT_MS : 0);

  const close = React.useCallback(async () => {
    if (locking) return;
    setLocking(true);
    await purgeOfflineCaches();
    await lockPrivacyAction();
  }, [locking]);

  React.useEffect(() => {
    if (!unlockedUntilMs) return;
    lastActivity.current = Date.now();
    let timeout = window.setTimeout(() => void close(), Math.max(0, unlockedUntilMs - Date.now()));

    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void close(), IDLE_TIMEOUT_MS);
      if (now - lastHeartbeat.current >= HEARTBEAT_MS) {
        lastHeartbeat.current = now;
        void touchPrivacyAction().then((result) => {
          if (!result.ok) void close();
        });
      }
    };

    for (const event of EVENTS) window.addEventListener(event, onActivity, { passive: true });
    const check = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_TIMEOUT_MS) void close();
    }, 10_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(check);
      for (const event of EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [close, unlockedUntilMs]);

  if (!unlockedUntilMs) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5"
        disabled={locking}
        onClick={() => void close()}
        aria-label="Lock private content now"
        title="Private content is unlocked; it locks after 15 minutes idle"
      >
        {locking ? <LockKeyhole className="size-4" /> : <ShieldCheck className="size-4" />}
        <span className="hidden sm:inline">{locking ? "Locking…" : "Private open"}</span>
      </Button>
      {locking ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-background" role="status">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyhole className="size-4" />
            Locking private content…
          </div>
        </div>
      ) : null}
    </>
  );
}
