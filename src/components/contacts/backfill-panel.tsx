"use client";

/**
 * Rapid backfill.
 *
 * Built for the desktop session where you sit down and dump years of history
 * about someone. Two things make that bearable, and both are deliberate:
 *
 *  * The form does not reset. After saving, the kind and the date stay put, so
 *    entering six things from 2019 means setting the year once.
 *  * Everything just added is listed, with undo — because entering fast means
 *    occasionally entering wrong.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField, DateTimeField } from "@/components/form/date-field";
import { TermChips, TermSelect, type TermOption } from "@/components/form/term-select";
import type { ActionResult } from "@/server/actions/helpers";
import { createInteraction, deleteInteraction } from "@/server/actions/interactions";
import {
  createFact,
  createImportantDate,
  createLifeEvent,
  deleteFact,
  deleteImportantDate,
  deleteLifeEvent,
} from "@/server/actions/details";

type Kind = "interaction" | "life-event" | "fact" | "important-date";

const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: "interaction", label: "Something you did", hint: "A meal, a call, a trip — with a date in the past." },
  { value: "life-event", label: "Something that happened to them", hint: "A job, a move, a milestone. A year on its own is fine." },
  { value: "fact", label: "Something to remember", hint: "A habit, a preference, a story. No date needed." },
  { value: "important-date", label: "A date worth remembering", hint: "Birthdays and anniversaries that come round." },
];

const BACKFILL_REACHED_OUT: ReadonlyArray<{ value: "ME" | "THEM" | "MUTUAL"; label: string }> = [
  { value: "ME", label: "I did" },
  { value: "THEM", label: "They did" },
  { value: "MUTUAL", label: "Mutual" },
];

interface AddedItem {
  id: string;
  kind: Kind;
  label: string;
}

export function BackfillPanel({
  contactId,
  contactName,
  interactionTypes,
  lifeEventTypes,
  factCategories,
  dateTypes,
}: {
  contactId: string;
  contactName: string;
  interactionTypes: TermOption[];
  lifeEventTypes: TermOption[];
  factCategories: TermOption[];
  dateTypes: TermOption[];
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState<Kind>("interaction");
  const [added, setAdded] = React.useState<AddedItem[]>([]);
  const [error, setError] = React.useState<string>();
  const [reachedOutBy, setReachedOutBy] = React.useState<"ME" | "THEM" | "MUTUAL" | null>(null);

  // Keeping the form mounted per kind is what preserves the date between
  // entries — remounting would reset it to today every time.
  const formRef = React.useRef<HTMLFormElement>(null);

  async function submit(form: FormData) {
    form.set("contactId", contactId);
    if (kind === "interaction") form.set("contactIds", contactId);
    if (kind === "interaction" && reachedOutBy) form.set("reachedOutBy", reachedOutBy);

    const action = {
      interaction: createInteraction,
      "life-event": createLifeEvent,
      fact: createFact,
      "important-date": createImportantDate,
    }[kind];

    const result = (await action(form)) as ActionResult<{ id: string }>;
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }

    setError(undefined);
    const label =
      (form.get("title") as string) ||
      (form.get("label") as string) ||
      (form.get("content") as string) ||
      "Entry";

    // Only list what we can actually undo — a fabricated id would give an
    // undo button that silently fails.
    if (result.data?.id) {
      setAdded((current) => [
        { id: result.data!.id, kind, label: label.slice(0, 80) },
        ...current,
      ]);
    }

    // Clear only the text fields — the date and type stay for the next entry.
    for (const field of ["title", "notes", "content", "label", "description"]) {
      const input = formRef.current?.elements.namedItem(field);
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.value = "";
      }
    }
    toast.success("Added");
    router.refresh();
  }

  async function undo(item: AddedItem) {
    const remove = {
      interaction: deleteInteraction,
      "life-event": deleteLifeEvent,
      fact: deleteFact,
      "important-date": deleteImportantDate,
    }[item.kind];

    const result = await remove(item.id);
    if (!result.ok) {
      toast.error(result.error ?? "Could not undo.");
      return;
    }
    setAdded((current) => current.filter((entry) => entry.id !== item.id));
    toast.success("Undone");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">What are you adding?</span>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                aria-pressed={kind === option.value}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  kind === option.value
                    ? "border-accent-8 bg-accent-3"
                    : "border-border hover:bg-muted",
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {error ? (
              <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            {/* One form per kind, so switching kinds swaps fields but staying on
                a kind preserves everything you already set. */}
            {kind === "interaction" ? (
              <form ref={formRef} action={submit} className="grid gap-3" key="interaction">
                <TermChips name="typeId" label="What was it?" terms={interactionTypes} allowEmpty={false} />
                {/* Deliberately not cleared between entries: reconstructing a
                    stretch of history usually means a run of the same answer,
                    and this is the one signal whose whole value is volume. */}
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Who got in touch?
                  </span>
                  <div className="flex gap-1.5">
                    {BACKFILL_REACHED_OUT.map((option) => (
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
                <DateTimeField
                  name="occurredAt"
                  label="When"
                  hint="Stays put between entries, so a run of dates from the same period is quick."
                />
                <Field label="Title" htmlFor="bf-title">
                  <Input id="bf-title" name="title" placeholder="Dinner at Thip Khao" />
                </Field>
                <Field label="Notes" htmlFor="bf-notes">
                  <Textarea id="bf-notes" name="notes" rows={2} />
                </Field>
                <SubmitButton>Add and keep going</SubmitButton>
              </form>
            ) : null}

            {kind === "life-event" ? (
              <form ref={formRef} action={submit} className="grid gap-3" key="life-event">
                <Field label="What happened?" htmlFor="bf-le-title">
                  <Input id="bf-le-title" name="title" required placeholder="Started at Deloitte" />
                </Field>
                <DateField
                  name="date"
                  label="When"
                  required
                  presets={["lastYear"]}
                  hint="Set precision to 'Year only' if that's all you remember."
                />
                <TermSelect name="typeId" label="Type" terms={lifeEventTypes} />
                <Field label="Anything more?" htmlFor="bf-le-description">
                  <Textarea id="bf-le-description" name="description" rows={2} />
                </Field>
                <SubmitButton>Add and keep going</SubmitButton>
              </form>
            ) : null}

            {kind === "fact" ? (
              <form ref={formRef} action={submit} className="grid gap-3" key="fact">
                <Field label="What should you remember?" htmlFor="bf-content">
                  <Textarea id="bf-content" name="content" rows={2} required />
                </Field>
                <TermChips name="categoryId" label="Category" terms={factCategories} />
                <SubmitButton>Add and keep going</SubmitButton>
              </form>
            ) : null}

            {kind === "important-date" ? (
              <form ref={formRef} action={submit} className="grid gap-3" key="important-date">
                <Field label="What is it?" htmlFor="bf-label">
                  <Input id="bf-label" name="label" required placeholder="Wedding anniversary" />
                </Field>
                <DateField name="date" label="When" required presets={[]} />
                <TermSelect name="typeId" label="Type" terms={dateTypes} />
                <SubmitButton>Add and keep going</SubmitButton>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-20">
        <CardContent className="pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Added this session
          </p>
          {added.length === 0 ? (
            <p className="pt-2 text-xs text-muted-foreground">
              Nothing yet. Everything you add for {contactName} shows up here.
            </p>
          ) : (
            <ul className="grid gap-1.5 pt-2">
              {added.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-lg border border-border/70 px-2.5 py-1.5"
                >
                  <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
                  <span className="min-w-0 flex-1 truncate text-xs">{item.label}</span>
                  <button
                    type="button"
                    onClick={() => void undo(item)}
                    aria-label={`Undo ${item.label}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
