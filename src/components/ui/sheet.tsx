"use client";

/**
 * Bottom sheet for mobile, side panel from `lg` up.
 *
 * Sheets are the default container for anything that would otherwise be a modal
 * — on a phone a sheet is reachable with a thumb and a centered dialog is not.
 */
import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

export const Sheet = DrawerPrimitive.Root;
export const SheetTrigger = DrawerPrimitive.Trigger;
export const SheetClose = DrawerPrimitive.Close;
export const SheetPortal = DrawerPrimitive.Portal;

export function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]", className)}
      {...props}
    />
  );
}

export function SheetContent({
  className,
  children,
  showHandle = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & { showHandle?: boolean }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DrawerPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden",
          "rounded-t-2xl border-t border-border bg-popover outline-none safe-bottom",
          className,
        )}
        {...props}
      >
        {showHandle ? (
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden />
        ) : null}
        {children}
      </DrawerPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("shrink-0 grid gap-1 px-4 pb-3 pt-4", className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4", className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "shrink-0 flex gap-2 border-t border-border bg-popover px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
