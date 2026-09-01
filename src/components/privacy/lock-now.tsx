"use client";

import * as React from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { purgeOfflineCaches } from "@/components/offline/offline";
import { lockPrivacyAction } from "@/server/actions/privacy";

/**
 * Closes the privacy lock on demand, without waiting out the idle timeout.
 *
 * The timeout is the safety net for walking away; this is for the moment you
 * know you are about to hand someone your phone. It also doubles as the only
 * indication that private content is open at all, which is worth showing: the
 * lock being closed is visible everywhere, the lock being open is not.
 *
 * Rendered only when the lock is enabled and currently unlocked, so it never
 * appears for an account that has no PIN set.
 */
export function LockNowButton() {
  const [locking, setLocking] = React.useState(false);

  async function lockNow() {
    if (locking) return;
    setLocking(true);
    // Caches first. `lockPrivacyAction` redirects, so anything left after it
    // may never run, and private pages written to disk would outlive the lock.
    await purgeOfflineCaches();
    await lockPrivacyAction();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        disabled={locking}
        onClick={() => void lockNow()}
        aria-label="Lock private content now"
        title="Private content is open. It locks itself after 15 minutes idle."
      >
        {locking ? (
          <LockKeyhole className="size-4" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        <span className="hidden sm:inline">{locking ? "Locking…" : "Private open"}</span>
      </Button>

      {/* Purging caches and reaching the server takes long enough to read a
          screen over somebody's shoulder, so cover what is already rendered
          for the duration rather than leaving it up until the redirect. */}
      {locking ? (
        <div
          role="status"
          className="fixed inset-0 z-[100] grid place-items-center bg-background"
        >
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyhole className="size-4" />
            Locking private content…
          </span>
        </div>
      ) : null}
    </>
  );
}
