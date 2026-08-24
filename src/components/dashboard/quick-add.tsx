"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LogInteractionSheet } from "@/components/contacts/log-interaction";
import type { TermOption } from "@/components/form/term-select";
import type { PickerContact } from "@/components/form/contact-picker";
import type { RenderableField } from "@/components/custom-fields/field-renderer";

/**
 * The one-tap entry point. Sits at the top of the dashboard on mobile, where
 * logging something is the most common reason to open the app at all.
 */
export function QuickAddWidget({
  contacts,
  types,
  customFields = [],
}: {
  contacts: PickerContact[];
  types: TermOption[];
  customFields?: RenderableField[];
}) {
  const [logging, setLogging] = React.useState(false);

  return (
    <Card className="lg:col-span-2">
      <CardContent className="flex flex-wrap gap-2 pt-4">
        <button
          type="button"
          onClick={() => setLogging(true)}
          className="tap flex flex-1 basis-40 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-10"
        >
          <Plus className="size-4" />
          Log interaction
        </button>
        <Link
          href="/people/new"
          className="tap flex flex-1 basis-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          <UserPlus className="size-4" />
          Add someone
        </Link>
      </CardContent>

      <LogInteractionSheet
        open={logging}
        onOpenChange={setLogging}
        contacts={contacts}
        types={types}
        customFields={customFields}
      />
    </Card>
  );
}
