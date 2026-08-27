"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * A popover taller than the space it has scrolls inside itself.
 *
 * Without the cap, Radix places what it cannot fit, and the overflow is simply
 * off-screen: on a phone the date picker's "Done" button sat below the fold
 * with no way to reach it, and an on-screen keyboard halves the room again.
 * `--radix-popover-content-available-height` is the room actually left on the
 * chosen side, so the content bounds itself to it and scrolls the rest.
 */
export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none",
          "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
