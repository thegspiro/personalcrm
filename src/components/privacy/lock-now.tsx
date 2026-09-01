"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
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
    try {
      // Caches first. `lockPrivacyAction` redirects, so anything sequenced
      // after it may never run, and private pages the service worker wrote to
      // disk would otherwise outlive the lock they were cached under.
      await purgeOfflineCaches();
      await lockPrivacyAction();
    } catch (error) {
      // A redirecting server action reports itself by throwing a digest. That
      // is the success path -- navigation is imminent -- so hold the overlay
      // rather than resetting, and do not rethrow into an unhandled rejection.
      const digest = (error as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return;

      // Anything else and the lock did not close. Leaving `locking` set would
      // strand the viewer under an overlay with no way back, which is worst
      // exactly where it is most likely: offline, where the request cannot
      // reach the server and the cached page has already been purged.
      setLocking(false);
      toast.error("Could not lock. Check your connection and try again.");
    }
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

      {/* Portalled to the body deliberately. The header carries
          `backdrop-blur-lg`, and a backdrop-filter other than none makes an
          element the containing block for its fixed-position descendants — so
          rendered in place this would size itself to the 56px header instead
          of the viewport, and cover nothing that matters. Measured: 784x56
          against a 800x600 viewport. */}
      {locking && typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              className="fixed inset-0 z-[100] grid place-items-center bg-background"
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <LockKeyhole className="size-4" />
                Locking private content…
              </span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
