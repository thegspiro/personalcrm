"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField } from "@/components/form/date-field";
import { endRelationship } from "@/server/actions/dating";

/**
 * Wrapping something up.
 *
 * Two separate fields on purpose: the reason is what happened, the
 * retrospective is what you make of it. Collapsing them into one box turns the
 * reflection into a postmortem note and makes both less useful later.
 */
export function EndRelationshipSheet({
  open,
  onOpenChange,
  contactId,
  contactName,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  defaults?: { endedReason: string | null; retrospective: string | null };
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string>();

  async function submit(form: FormData) {
    form.set("contactId", contactId);
    const result = await endRelationship(form);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }
    setError(undefined);
    toast.success("Recorded");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="lg:mx-auto lg:max-w-lg">
        <form action={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>End things with {contactName}</SheetTitle>
            <SheetDescription>
              Nothing is deleted — every date, flag and note stays on their page.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="grid gap-3.5">
            {error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <DateField
              name="endedOn"
              label="When"
              allowPrecision={false}
              presets={["today", "lastWeek", "lastMonth"]}
            />

            <Field label="What happened?" htmlFor="endedReason">
              <Textarea
                id="endedReason"
                name="endedReason"
                rows={2}
                defaultValue={defaults?.endedReason ?? ""}
                placeholder="She's moving to Chicago in the spring."
              />
            </Field>

            <Field
              label="Looking back"
              htmlFor="retrospective"
              hint="What you'd want to remember next time. Optional, and only for you."
            >
              <Textarea
                id="retrospective"
                name="retrospective"
                rows={3}
                defaultValue={defaults?.retrospective ?? ""}
                placeholder="I waited too long to say what I actually wanted."
              />
            </Field>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton className="flex-1">Record it</SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
