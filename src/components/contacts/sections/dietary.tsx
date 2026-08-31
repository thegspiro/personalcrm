"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { DIETARY_GROUPS, DIETARY_KINDS, DIETARY_KIND_LABELS, mustAvoid, type DietaryKind } from "@/lib/dietary";
import { createDietaryNeed, deleteDietaryNeed, updateDietaryNeed } from "@/server/actions/details";

export interface DietaryItem {
  id: string;
  kind: DietaryKind;
  label: string;
  notes: string | null;
  carriesEpinephrine: boolean;
}

/**
 * Adding a dietary need and correcting one.
 *
 * The kind is a controlled chip row rather than a select, so it carries its own
 * state and submits through a hidden input — the same shape either way, opening
 * on Allergy when new and on whatever was recorded when editing.
 */
function DietaryFields({ formId, need }: { formId: string; need?: DietaryItem }) {
  const [kind, setKind] = React.useState<DietaryKind>(need?.kind ?? "ALLERGY");

  return (
    <>
      <input type="hidden" name="kind" value={kind} />

      <Field label="What should they avoid?" htmlFor={`${formId}-label`}>
        <Input
          id={`${formId}-label`}
          name="label"
          required
          defaultValue={need?.label ?? ""}
          placeholder="Shellfish"
        />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">What kind?</span>
        <div className="flex flex-wrap gap-1.5">
          {DIETARY_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "min-h-9 rounded-full border px-3 py-1 text-xs transition-colors",
                kind === option
                  ? "border-accent-8 bg-accent-3 text-accent-11"
                  : "border-border hover:bg-muted",
              )}
            >
              {DIETARY_KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <Field label="Anything else worth knowing?" htmlFor={`${formId}-notes`}>
        <Textarea
          id={`${formId}-notes`}
          name="notes"
          rows={2}
          defaultValue={need?.notes ?? ""}
          placeholder="Fine with it cooked, reacts to it raw."
        />
      </Field>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="carriesEpinephrine"
          value="true"
          defaultChecked={need?.carriesEpinephrine ?? false}
          className="size-4"
        />
        Carries adrenaline for this
      </label>
    </>
  );
}

/**
 * What someone can't, or won't, eat.
 *
 * Two headings only, whatever the four kinds record — see `@/lib/dietary`. The
 * add form opens on Allergy rather than on nothing, because the two ways of
 * getting this wrong do not cost the same.
 */
export function DietarySection({
  contactId,
  needs,
}: {
  contactId: string;
  needs: DietaryItem[];
}) {
  const run = useAction();
  const add = useAddAction();

  const groups = DIETARY_GROUPS.map((group) => ({
    ...group,
    items: needs.filter((need) => group.kinds.includes(need.kind as never)),
  })).filter((group) => group.items.length > 0);

  return (
    <SectionCard
      title="Food and drink to avoid"
      icon="UtensilsCrossed"
      count={needs.length}
      addLabel="Add a dietary need"
      form={(close) => (
        <form action={add(createDietaryNeed, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <DietaryFields formId="diet-new" />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {needs.length === 0 ? (
        <SectionEmpty>Nothing noted — worth asking before you cook for them.</SectionEmpty>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="grid gap-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.heading}
            </h3>
            {group.items.map((need) => (
              <SectionRow
                key={need.id}
                className={mustAvoid(need.kind) ? "border-destructive/40 bg-destructive/5" : undefined}
                onDelete={() => void run(() => deleteDietaryNeed(need.id), "Removed")}
                deleteLabel="Remove dietary need"
                editLabel="Edit dietary need"
                editForm={(close) => (
                  <form action={add(updateDietaryNeed, close, "Saved")} className="grid gap-2.5">
                    <input type="hidden" name="id" value={need.id} />
                    <DietaryFields formId={`diet-${need.id}`} need={need} />
                    <SubmitButton size="sm">Save</SubmitButton>
                  </form>
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{need.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {DIETARY_KIND_LABELS[need.kind]}
                  </span>
                  {need.carriesEpinephrine ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Carries adrenaline
                    </Badge>
                  ) : null}
                </div>
                {need.notes ? (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                    {need.notes}
                  </p>
                ) : null}
              </SectionRow>
            ))}
          </div>
        ))
      )}
    </SectionCard>
  );
}
