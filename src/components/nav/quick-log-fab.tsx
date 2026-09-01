"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { LogInteractionSheet } from "@/components/contacts/log-interaction";
import type { TermOption } from "@/components/form/term-select";
import type { PickerContact } from "@/components/form/contact-picker";
import type { RenderableField } from "@/components/custom-fields/field-renderer";

/** Screens where you are browsing rather than filling something in. */
const SHOW_ON = ["/", "/people", "/timeline"];

/**
 * A thumb-reachable way to log something from wherever you are.
 *
 * The sheet itself already existed and is already reused by the dashboard
 * widget; what was missing was a way to reach it without navigating first. On
 * a phone, at the moment you remember, that navigation is enough friction to
 * mean the interaction never gets logged at all.
 *
 * Hidden on form pages, where a floating button over the thing you are typing
 * into is just in the way.
 */
export function QuickLogFab({
  contacts,
  types,
  customFields = [],
}: {
  contacts: PickerContact[];
  types: TermOption[];
  customFields?: RenderableField[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = React.useState(false);

  // The command palette offers "Log an interaction" from anywhere, and the
  // sheet it wants lives here. It navigates to /?log=1 rather than reaching
  // across the component tree; this is the other half of that. Derived rather
  // than synced into state with an effect, so there is no render where the
  // parameter is set and the sheet is still shut.
  const requested = params.get("log") === "1";
  const isOpen = open || requested;

  function change(next: boolean) {
    setOpen(next);
    // Drop the parameter on close, so a refresh or the back button does not
    // reopen a sheet that has already been dismissed.
    if (!next && requested) router.replace(pathname, { scroll: false });
  }

  if (!SHOW_ON.includes(pathname)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => change(true)}
        aria-label="Log an interaction"
        className="bottom-fab fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
      >
        <Plus className="size-6" />
      </button>

      <LogInteractionSheet
        open={isOpen}
        onOpenChange={change}
        contacts={contacts}
        types={types}
        customFields={customFields}
      />
    </>
  );
}
