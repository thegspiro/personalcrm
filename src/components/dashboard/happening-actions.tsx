"use client";

import { useAction } from "@/components/form/use-action";
import { acknowledgeHappening } from "@/server/actions/details";

/**
 * Dismiss a finished happening from the follow-up list.
 *
 * Its own client component because `widgets.tsx` is a server component, and a
 * dashboard that lost its server rendering to one button would be a poor trade.
 */
export function AcknowledgeHappeningButton({ id, label }: { id: string; label: string }) {
  const run = useAction();

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void run(() => acknowledgeHappening(id), "Dismissed")}
      className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Dismiss
    </button>
  );
}
