"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useManualPrivacyLock } from "./privacy-activity-controller";

/**
 * Closes the privacy lock on demand, without waiting out the idle timeout.
 *
 * The timeout is the safety net for walking away; this is for the moment you
 * know you are about to hand someone your phone. It also doubles as the only
 * indication that private content is open at all, which is worth showing: the
 * lock being closed is visible everywhere, the lock being open is not.
 *
 * The work belongs to `PrivacyActivityController`, which already unmounts the
 * shell when the deadline passes. Reaching for that rather than drawing a
 * cover over the page is what makes the private content actually unreachable
 * while the lock closes, rather than merely unseen.
 */
export function LockNowButton() {
  const lock = useManualPrivacyLock();
  if (!lock) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      disabled={lock.locking}
      onClick={lock.lockNow}
      aria-label="Lock private content now"
      title="Private content is open. It locks itself after 15 minutes idle."
    >
      {lock.locking ? (
        <LockKeyhole className="size-4" />
      ) : (
        <ShieldCheck className="size-4" />
      )}
      <span className="hidden sm:inline">{lock.locking ? "Locking…" : "Private open"}</span>
    </Button>
  );
}
