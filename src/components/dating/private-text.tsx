"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Blurs sensitive text until it is deliberately revealed.
 *
 * A second, weaker layer *after* the PIN lock: once you have unlocked, this
 * still keeps private notes and flags from being readable by someone glancing
 * at your screen. It is presentation only — the data is already on the page by
 * this point, which is exactly why the real gate lives in the query layer.
 */
export function PrivateText({
  children,
  enabled = true,
  className,
  label = "Reveal",
}: {
  children: React.ReactNode;
  enabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);

  if (!enabled) return <span className={className}>{children}</span>;

  if (revealed) {
    return (
      <span
        className={cn("cursor-pointer", className)}
        onClick={() => setRevealed(false)}
        title="Hide again"
      >
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={cn("group relative inline-flex max-w-full text-left", className)}
      aria-label={label}
    >
      <span className="select-none blur-[5px] transition-[filter] group-hover:blur-[4px]" aria-hidden>
        {children}
      </span>
      <span className="absolute inset-0 flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Eye className="size-3" />
        {label}
      </span>
    </button>
  );
}
