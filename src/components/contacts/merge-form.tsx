"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeDuplicate } from "@/server/actions/duplicates";
import { MERGE_FIELDS, isConflict, isFilledFromOther } from "@/lib/merge-fields";
import type { MergeSide } from "@/server/queries/duplicates";
import { cn } from "@/lib/utils";

type Side = "winner" | "loser";

function displayName(contact: MergeSide): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function show(value: unknown, kind: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "number") return `${value} days`;
  return String(value);
}

/**
 * Choosing what survives when two records become one.
 *
 * Two decisions, in this order, because the second depends on the first: which
 * record is kept, and then — only for the fields where the two genuinely
 * disagree — whose answer wins.
 *
 * Fields that match, and fields only one side answered, are not shown as
 * questions. Something beats nothing, and a screen listing twenty identical
 * rows buries the two that matter.
 *
 * The form sends a *side* per field, never a value: the server reads the answer
 * off the record that was chosen, so nothing here can write arbitrary data into
 * a contact.
 */
export function MergeForm({ a, b }: { a: MergeSide; b: MergeSide }) {
  const router = useRouter();
  const [winnerId, setWinnerId] = React.useState(a.id);
  const [choices, setChoices] = React.useState<Record<string, Side>>({});
  const [busy, setBusy] = React.useState(false);

  const winner = winnerId === a.id ? a : b;
  const loser = winnerId === a.id ? b : a;

  const conflicts = MERGE_FIELDS.filter((spec) =>
    isConflict(
      winner[spec.field as keyof MergeSide],
      loser[spec.field as keyof MergeSide],
    ),
  );
  const filled = MERGE_FIELDS.filter((spec) =>
    isFilledFromOther(
      winner[spec.field as keyof MergeSide],
      loser[spec.field as keyof MergeSide],
    ),
  );

  // Every conflict defaults to the surviving record's own answer, so submitting
  // without touching anything does the least surprising thing.
  const choiceFor = (field: string): Side => choices[field] ?? "winner";

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("winnerId", winner.id);
      form.set("loserId", loser.id);
      // Fields only the loser answered are sent too: they are not conflicts,
      // but they are still the loser's value moving onto the survivor.
      const payload: Record<string, Side> = {};
      for (const spec of conflicts) payload[spec.field] = choiceFor(spec.field);
      for (const spec of filled) payload[spec.field] = "loser";
      form.set("choices", JSON.stringify(payload));

      const result = await mergeDuplicate(form);
      if (!result.ok) {
        toast.error(result.error ?? "They could not be merged.");
        return;
      }
      toast.success(`Merged into ${displayName(winner)}.`);
      router.push(`/people/${winner.id}`);
    } catch (error) {
      console.error("Merge failed", error);
      toast.error("They could not be merged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Merge two people</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything recorded against both — history, dates, gifts, notes — ends up on the
          one you keep.
        </p>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
        <AlertTriangle className="mt-px size-3.5 shrink-0" />
        <span>
          This cannot be undone. The record you do not keep is deleted once everything has
          been moved off it.
        </span>
      </p>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Which record do you want to keep?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[a, b].map((candidate) => (
            <label
              key={candidate.id}
              className={cn(
                "grid min-w-0 cursor-pointer gap-1 rounded-lg border p-3",
                winnerId === candidate.id ? "border-accent-8 bg-accent-3" : "border-border",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="winner"
                  value={candidate.id}
                  checked={winnerId === candidate.id}
                  onChange={() => {
                    setWinnerId(candidate.id);
                    // The old answers were about the other survivor.
                    setChoices({});
                  }}
                />
                <span className="truncate text-sm font-medium">{displayName(candidate)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {candidate._count.participations} interactions · {candidate.methods.length}{" "}
                contact details · {candidate._count.facts} notes
              </span>
              <span className="text-xs text-muted-foreground">
                Added {candidate.createdAt.toISOString().slice(0, 10)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {conflicts.length > 0 ? (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            These disagree — choose which answer to keep
          </legend>
          <ul className="grid gap-2">
            {conflicts.map((spec) => (
              <li key={spec.field}>
                {/*
                  A fieldset per field, not a paragraph and two radios. The
                  radios are a group and need a group name: without a legend
                  their only accessible name is the value plus a person, so
                  "Leeds, Sam Carter" is all a screen reader announces and the
                  question — which field this is — is never said at all.
                */}
                <fieldset className="grid gap-1.5 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-medium">{spec.label}</legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {(["winner", "loser"] as const).map((side) => {
                    const source = side === "winner" ? winner : loser;
                    return (
                      <label key={side} className="flex min-w-0 items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={spec.field}
                          checked={choiceFor(spec.field) === side}
                          onChange={() =>
                            setChoices((current) => ({ ...current, [spec.field]: side }))
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate">
                            {show(source[spec.field as keyof MergeSide], spec.kind)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {displayName(source)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Nothing the two records both answer disagrees, so there is nothing to choose
          between.
        </p>
      )}

      {filled.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Filled in from {displayName(loser)}: {filled.map((spec) => spec.label).join(", ")}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button loading={busy} onClick={() => void submit()}>
          <Merge />
          Merge into {displayName(winner)}
        </Button>
        <Button variant="outline" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
