"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import type { TermOption } from "@/components/form/term-select";
import {
  confirmQuickAdd,
  interpretQuickAdd,
  type QuickAddPreview,
} from "@/server/actions/quick-add";

/**
 * Type one line, confirm what it understood.
 *
 * Reading and writing are two steps on purpose. The parse only ever fills a
 * form — being wrong costs a correction, not a bad record — and the form is
 * fully editable before anything is saved.
 */
export function QuickAddBox({
  types,
  className,
  autoFocus,
  onDone,
}: {
  types: TermOption[];
  className?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<QuickAddPreview | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function read() {
    if (!text.trim()) return;
    setReading(true);
    setError(null);
    const result = await interpretQuickAdd(text);
    setReading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Couldn't read that.");
      return;
    }
    setPreview(result.data);
  }

  function reset() {
    setText("");
    setPreview(null);
    setError(null);
  }

  if (preview) {
    return (
      <QuickAddPreviewForm
        preview={preview}
        types={types}
        original={text}
        className={className}
        onCancel={reset}
        onSaved={() => {
          reset();
          router.refresh();
          onDone?.();
        }}
      />
    );
  }

  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-2", className)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void read();
        }}
        className="flex min-w-0 items-center gap-2"
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="coffee with Sarah yesterday"
          aria-label="Describe what happened"
          autoFocus={autoFocus}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" className="shrink-0" disabled={!text.trim() || reading}>
          {reading ? "Reading…" : "Read"}
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function QuickAddPreviewForm({
  preview,
  types,
  original,
  className,
  onCancel,
  onSaved,
}: {
  preview: QuickAddPreview;
  types: TermOption[];
  original: string;
  className?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // One choice per ambiguous name, starting empty so nothing is picked for you.
  const [choices, setChoices] = React.useState<Record<number, string>>({});
  const [newNames, setNewNames] = React.useState<string[]>(preview.newNames);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const unresolved = preview.ambiguous.filter((_, index) => !choices[index]);
  const blocked = unresolved.length > 0;

  async function save(form: FormData) {
    setSaving(true);
    setError(null);
    const result = await confirmQuickAdd(form);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    toast.success("Logged");
    onSaved();
  }

  return (
    <form
      action={save}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-border bg-card p-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            From &ldquo;{original}&rdquo;
          </p>
          {preview.assistNote ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{preview.assistNote}</p>
          ) : null}
        </div>
      </div>

      {preview.ambiguous.map((entry, index) => (
        <fieldset
          key={`${entry.matchedText}-${index}`}
          className="grid gap-1.5 rounded-lg border border-dashed border-border p-2.5"
        >
          <legend className="px-1 text-xs font-medium">
            Which {entry.matchedText}?
          </legend>
          <p className="text-[11px] text-muted-foreground">
            More than one person goes by that name, so nothing is assumed.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entry.candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-border px-3 text-xs has-[:checked]:border-accent-8 has-[:checked]:bg-accent-3 has-[:checked]:text-accent-11"
              >
                <input
                  type="radio"
                  name={`ambiguous-${index}`}
                  value={candidate.id}
                  checked={choices[index] === candidate.id}
                  onChange={() => setChoices((c) => ({ ...c, [index]: candidate.id }))}
                  className="sr-only"
                />
                <span className="truncate">{candidate.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">With</span>
        <div className="flex flex-wrap gap-1.5">
          {preview.contacts.map((person) => (
            <span
              key={person.id}
              className="inline-flex max-w-full items-center rounded-full bg-accent-3 px-2.5 py-1 text-xs text-accent-11"
            >
              <input type="hidden" name="contactIds" value={person.id} />
              <span className="truncate">{person.name}</span>
            </span>
          ))}
          {Object.values(choices).map((id) => {
            const person = preview.ambiguous
              .flatMap((entry) => entry.candidates)
              .find((candidate) => candidate.id === id);
            return person ? (
              <span
                key={id}
                className="inline-flex max-w-full items-center rounded-full bg-accent-3 px-2.5 py-1 text-xs text-accent-11"
              >
                <input type="hidden" name="contactIds" value={id} />
                <span className="truncate">{person.name}</span>
              </span>
            ) : null;
          })}
          {newNames.map((name) => (
            <label
              key={name}
              className="inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs"
            >
              <input type="checkbox" name="newNames" value={name} defaultChecked className="size-3.5" />
              <span className="truncate">{name}</span>
              <span className="shrink-0 text-muted-foreground">new</span>
            </label>
          ))}
          {preview.contacts.length === 0 &&
          newNames.length === 0 &&
          Object.keys(choices).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {preview.ambiguous.length > 0
                ? "Once you have picked above."
                : "Nobody recognised in that line."}
            </p>
          ) : null}
        </div>
        {newNames.length > 0 ? (
          <button
            type="button"
            onClick={() => setNewNames([])}
            className="justify-self-start text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Don&apos;t add anyone new
          </button>
        ) : null}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="What" htmlFor="qa-title">
          <Input id="qa-title" name="title" defaultValue={preview.title} />
        </Field>
        <Field
          label="When"
          htmlFor="qa-date"
          hint={preview.dateText ? `read from "${preview.dateText}"` : "no date in that line"}
        >
          <Input id="qa-date" name="date" type="date" defaultValue={preview.date} required />
        </Field>
      </div>

      <Field label="Type" htmlFor="qa-type">
        <select
          id="qa-type"
          name="typeId"
          defaultValue={preview.typeId ?? ""}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">No type</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
      </Field>

      {preview.notes ? (
        <Field label="Notes" htmlFor="qa-notes">
          <Input id="qa-notes" name="notes" defaultValue={preview.notes} />
        </Field>
      ) : (
        <input type="hidden" name="notes" value="" />
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {blocked ? (
        <p className="text-xs text-muted-foreground">
          Pick which person {unresolved.length === 1 ? "that name means" : "those names mean"}{" "}
          before saving.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" disabled={blocked || saving}>
          Log it
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Start over
        </Button>
        {preview.source === "assisted" ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <WandSparkles className="size-3" />
            read with help
          </span>
        ) : null}
      </div>
    </form>
  );
}
