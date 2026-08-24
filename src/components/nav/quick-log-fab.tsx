"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
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
  const [open, setOpen] = React.useState(false);

  if (!SHOW_ON.includes(pathname)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Log an interaction"
        className="bottom-fab fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
      >
        <Plus className="size-6" />
      </button>

      <LogInteractionSheet
        open={open}
        onOpenChange={setOpen}
        contacts={contacts}
        types={types}
        customFields={customFields}
      />
    </>
  );
}
