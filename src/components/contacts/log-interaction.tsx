"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/form/submit-button";
import {
  CollapsibleCustomFields,
  type RenderableField,
} from "@/components/custom-fields/field-renderer";
import { DateTimeField } from "@/components/form/date-field";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SENTIMENTS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createInteraction } from "@/server/actions/interactions";

type ReachedOutBy = "ME" | "THEM" | "MUTUAL";

const REACHED_OUT_OPTIONS: ReadonlyArray<{ value: ReachedOutBy; label: string }> = [
  { value: "ME", label: "I did" },
  { value: "THEM", label: "They did" },
  { value: "MUTUAL", label: "Mutual" },
];

/**
 * Log something that happened.
 *
 * The date defaults to now but is fully editable, including into the past —
 * backdating here is a first-class action, not an edge case. Contact activity
 * is recomputed server-side from full history, so logging an old coffee will
 * not make it look like you spoke today.
 */
export function LogInteractionSheet({
  open,
  onOpenChange,
  contacts,
  types,
  defaultContactIds = [],
  defaultOccurredAt,
  onLogged,
  customFields = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: PickerContact[];
  types: TermOption[];
  defaultContactIds?: string[];
  defaultOccurredAt?: Date;
  onLogged?: () => void;
  /** Your own interaction fields — collapsed, so logging stays fast. */
  customFields?: RenderableField[];
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string>();
  const [sentiment, setSentiment] = React.useState<number | null>(null);
  const [reachedOutBy, setReachedOutBy] = React.useState<ReachedOutBy | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (open) formRef.current?.reset();
  }, [open]);

  async function onSubmit(form: FormData) {
    if (sentiment !== null) form.set("sentiment", String(sentiment));
    // Left unset the field stays UNSPECIFIED, which is the honest answer when
    // you genuinely don't remember who called whom.
    if (reachedOutBy !== null) form.set("reachedOutBy", reachedOutBy);

    const result = await createInteraction(form);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }

    setError(undefined);
    setSentiment(null);
    setReachedOutBy(null);
    formRef.current?.reset();
    toast.success("Logged");
    onOpenChange(false);
    onLogged?.();
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="lg:mx-auto lg:max-w-lg">
        <form ref={formRef} action={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>Log an interaction</SheetTitle>
            <SheetDescription>
              Happened a while ago? Change the date — it won&apos;t affect who you&apos;re overdue with.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="grid gap-3.5">
            {error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <ContactPicker
              name="contactIds"
              label="Who was there?"
              contacts={contacts}
              defaultSelected={defaultContactIds}
              required
            />

            <ContactPicker
              name="mentionedContactIds"
              label="People mentioned (optional)"
              contacts={contacts}
            />

            <TermChips name="typeId" label="What" terms={types} allowEmpty={false} />

            <DateTimeField name="occurredAt" label="When" defaultValue={defaultOccurredAt} />

            <Field label="Title" htmlFor="title">
              <Input id="title" name="title" placeholder="Coffee at Northside" />
            </Field>

            <Field label="Notes" htmlFor="notes">
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="What did you talk about? Anything to remember?"
              />
            </Field>

            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Who got in touch?</span>
              <div className="flex gap-1.5">
                {REACHED_OUT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={reachedOutBy === option.value}
                    onClick={() =>
                      setReachedOutBy((current) =>
                        current === option.value ? null : option.value,
                      )
                    }
                    className={cn(
                      "min-h-11 flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors",
                      reachedOutBy === option.value
                        ? "border-accent-8 bg-accent-3 text-accent-11"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">How did it go?</span>
              <div className="flex gap-1.5">
                {SENTIMENTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={sentiment === option.value}
                    onClick={() =>
                      setSentiment((current) => (current === option.value ? null : option.value))
                    }
                    className={cn(
                      "flex min-h-11 flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] transition-colors",
                      sentiment === option.value
                        ? "border-accent-8 bg-accent-3 text-accent-11"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="text-base leading-none">{option.emoji}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <CollapsibleCustomFields fields={customFields} />
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton className="flex-1">Log it</SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
