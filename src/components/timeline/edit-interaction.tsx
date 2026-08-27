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
import { CollapsibleCustomFields } from "@/components/custom-fields/field-renderer";
import { DateTimeField } from "@/components/form/date-field";
import { TermChips } from "@/components/form/term-select";
import { ContactPicker } from "@/components/form/contact-picker";
import { SENTIMENTS } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  loadInteractionForEdit,
  updateInteraction,
  type InteractionForEdit,
} from "@/server/actions/interactions";

type ReachedOutBy = "ME" | "THEM" | "MUTUAL";

const REACHED_OUT_OPTIONS: ReadonlyArray<{ value: ReachedOutBy; label: string }> = [
  { value: "ME", label: "I did" },
  { value: "THEM", label: "They did" },
  { value: "MUTUAL", label: "Mutual" },
];

/**
 * Correct something already logged.
 *
 * The counterpart to `LogInteractionSheet`, and the answer to a record you can
 * see is wrong but cannot fix. Quick add reads a person, a type and a date out
 * of one typed line; when it reads one of them badly the only remedy used to
 * be deleting the interaction and typing it again, which throws away the
 * custom fields and the sentiment along with the mistake.
 *
 * The record is fetched when the sheet opens rather than carried in the
 * timeline payload: a feed of a hundred rows should not ship a hundred contact
 * pickers to the browser for the one row you might edit.
 */
export function EditInteractionSheet({
  interactionId,
  open,
  onOpenChange,
}: {
  interactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [record, setRecord] = React.useState<InteractionForEdit | null>(null);
  const [loadError, setLoadError] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [sentiment, setSentiment] = React.useState<number | null>(null);
  const [reachedOutBy, setReachedOutBy] = React.useState<ReachedOutBy | null>(null);

  React.useEffect(() => {
    if (!open || !interactionId) return;

    // The sheet can be closed before this resolves, and a stale answer
    // arriving afterwards would repopulate a form nobody is looking at. The
    // caller remounts per row, so there is no earlier record to clear here.
    let current = true;

    void loadInteractionForEdit(interactionId).then((result) => {
      if (!current) return;
      if (!result.ok || !result.data) {
        setLoadError(result.error ?? "Could not open that.");
        return;
      }
      setRecord(result.data);
      setSentiment(result.data.sentiment);
      setReachedOutBy(
        result.data.reachedOutBy === "ME" ||
          result.data.reachedOutBy === "THEM" ||
          result.data.reachedOutBy === "MUTUAL"
          ? result.data.reachedOutBy
          : null,
      );
    });

    return () => {
      current = false;
    };
  }, [open, interactionId]);

  async function onSubmit(form: FormData) {
    if (sentiment !== null) form.set("sentiment", String(sentiment));
    // Cleared rather than left alone: an edit that unsets "they called" has to
    // be able to put the answer back to nobody-remembers.
    if (reachedOutBy !== null) form.set("reachedOutBy", reachedOutBy);

    const result = await updateInteraction(form);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }

    setError(undefined);
    toast.success("Saved");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="lg:mx-auto lg:max-w-lg">
        {record ? (
          <form
            // Keyed on the record so reopening the sheet on another row starts
            // from that row's values instead of the last one's.
            key={record.id}
            action={onSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <input type="hidden" name="id" value={record.id} />

            <SheetHeader>
              <SheetTitle>Edit interaction</SheetTitle>
              <SheetDescription>
                Changing the date is safe — who you&apos;re overdue with is worked out again from
                scratch.
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
                label="Who"
                contacts={record.contacts}
                defaultSelected={record.contactIds}
                required
              />

              <TermChips
                name="typeId"
                label="What"
                terms={record.types}
                defaultValue={record.typeId ?? undefined}
                allowEmpty={false}
              />

              <DateTimeField name="occurredAt" label="When" defaultValue={record.occurredAt} />

              <Field label="Title" htmlFor="edit-title">
                <Input
                  id="edit-title"
                  name="title"
                  defaultValue={record.title ?? ""}
                  placeholder="Coffee at Northside"
                />
              </Field>

              <Field label="Notes" htmlFor="edit-notes">
                <Textarea
                  id="edit-notes"
                  name="notes"
                  rows={3}
                  defaultValue={record.notes ?? ""}
                  placeholder="What did you talk about? Anything to remember?"
                />
              </Field>

              <Field label="Where" htmlFor="edit-location">
                <Input
                  id="edit-location"
                  name="location"
                  defaultValue={record.location ?? ""}
                  placeholder="Northside Cafe"
                />
              </Field>

              {/*
                Rendered even though the log form has no such input, because
                the action writes the column on every save: leave the field out
                and editing a title would quietly wipe a duration that came
                from somewhere else.
              */}
              <Field label="How long (minutes)" htmlFor="edit-duration">
                <Input
                  id="edit-duration"
                  name="durationMinutes"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  defaultValue={record.durationMinutes ?? ""}
                  placeholder="90"
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

              <CollapsibleCustomFields fields={record.customFields} />
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton className="flex-1">Save changes</SubmitButton>
            </SheetFooter>
          </form>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Edit interaction</SheetTitle>
              <SheetDescription>
                {loadError ?? "Fetching what you logged…"}
              </SheetDescription>
            </SheetHeader>
            <SheetBody />
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
