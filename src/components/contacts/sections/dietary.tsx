"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import {
  ALLERGY_CATEGORY_LABELS,
  DIETARY_KIND_LABELS,
  dietaryDisplayGroup,
  mustAvoid,
  type AllergyCategory,
  type DietaryKind,
} from "@/lib/dietary";
import { createDietaryNeed, deleteDietaryNeed, updateDietaryNeed } from "@/server/actions/details";

export interface DietaryItem {
  id: string;
  kind: DietaryKind;
  allergyCategory: AllergyCategory;
  label: string;
  notes: string | null;
  carriesEpinephrine: boolean;
}

const CHOICES: ReadonlyArray<{ kind: DietaryKind; category: AllergyCategory; label: string }> = [
  { kind: "ALLERGY", category: "FOOD", label: "Food allergy" },
  { kind: "ALLERGY", category: "MEDICATION", label: "Medication allergy" },
  { kind: "ALLERGY", category: "ENVIRONMENTAL", label: "Environmental allergy" },
  { kind: "ALLERGY", category: "OTHER", label: "Other allergy" },
  { kind: "INTOLERANCE", category: "FOOD", label: "Food intolerance" },
  { kind: "MEDICAL", category: "FOOD", label: "Medical dietary restriction" },
  { kind: "PREFERENCE", category: "FOOD", label: "Food preference" },
];

function DietaryFields({ formId, need }: { formId: string; need?: DietaryItem }) {
  const [selection, setSelection] = React.useState(() => ({
    kind: need?.kind ?? "ALLERGY" as DietaryKind,
    category: need?.kind === "ALLERGY" ? need.allergyCategory : "FOOD" as AllergyCategory,
  }));
  const isAllergy = selection.kind === "ALLERGY";

  return <>
    <input type="hidden" name="kind" value={selection.kind} />
    <input type="hidden" name="allergyCategory" value={selection.category} />
    <Field label="What do they need to avoid?" htmlFor={`${formId}-label`}>
      <Input id={`${formId}-label`} name="label" required defaultValue={need?.label ?? ""}
        placeholder={selection.category === "MEDICATION" ? "Penicillin" : selection.category === "ENVIRONMENTAL" ? "Pollen" : "Shellfish"} />
    </Field>
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Need or allergy type</span>
      <div className="flex flex-wrap gap-1.5">
        {CHOICES.map((choice) => {
          const active = selection.kind === choice.kind &&
            (choice.kind !== "ALLERGY" || selection.category === choice.category);
          return <button key={`${choice.kind}-${choice.category}`} type="button" aria-pressed={active}
            onClick={() => setSelection({ kind: choice.kind, category: choice.category })}
            className={cn("min-h-9 rounded-full border px-3 py-1 text-xs transition-colors",
              active ? "border-accent-8 bg-accent-3 text-accent-11" : "border-border hover:bg-muted")}>{choice.label}</button>;
        })}
      </div>
    </div>
    <Field label="Anything else worth knowing?" htmlFor={`${formId}-notes`}>
      <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={need?.notes ?? ""}
        placeholder="Include practical details that help keep them safe." />
    </Field>
    {isAllergy ? <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" name="carriesEpinephrine" value="true"
        defaultChecked={need?.kind === "ALLERGY" && need.carriesEpinephrine} className="size-4" />
      Carries epinephrine for this allergy
    </label> : null}
  </>;
}

const GROUPS = [
  { id: "allergies", heading: "Allergies" },
  { id: "dietary", heading: "Dietary restrictions" },
  { id: "preferences", heading: "Food preferences" },
] as const;

export function DietarySection({ contactId, needs }: { contactId: string; needs: DietaryItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const groups = GROUPS.map((group) => ({ ...group,
    items: needs.filter((need) => dietaryDisplayGroup(need.kind) === group.id),
  })).filter((group) => group.items.length);

  return <SectionCard title="Allergies and dietary needs" icon="UtensilsCrossed" count={needs.length}
    addLabel="Add an allergy or dietary need" form={(close) =>
      <form action={add(createDietaryNeed, close, "Noted")} className="grid gap-2.5">
        <input type="hidden" name="contactId" value={contactId} />
        <DietaryFields formId="diet-new" /><SubmitButton size="sm">Add need</SubmitButton>
      </form>}>
    {!needs.length ? <SectionEmpty>No allergies or dietary needs noted.</SectionEmpty> : groups.map((group) =>
      <div key={group.id} className="grid gap-2">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.heading}</h3>
        {group.items.map((need) => <SectionRow key={need.id}
          className={mustAvoid(need.kind) ? "border-destructive/40 bg-destructive/5" : undefined}
          onDelete={() => void run(() => deleteDietaryNeed(need.id), "Removed")}
          deleteLabel="Remove allergy or dietary need" editLabel="Edit allergy or dietary need"
          editForm={(close) => <form action={add(updateDietaryNeed, close, "Saved")} className="grid gap-2.5">
            <input type="hidden" name="id" value={need.id} /><DietaryFields formId={`diet-${need.id}`} need={need} />
            <SubmitButton size="sm">Save changes</SubmitButton></form>}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{need.label}</span>
            <span className="text-[11px] text-muted-foreground">{need.kind === "ALLERGY" ? ALLERGY_CATEGORY_LABELS[need.allergyCategory] : DIETARY_KIND_LABELS[need.kind]}</span>
            {need.kind === "ALLERGY" && need.carriesEpinephrine ? <Badge variant="destructive" className="text-[10px]">Carries epinephrine</Badge> : null}
          </div>
          {need.notes ? <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{need.notes}</p> : null}
        </SectionRow>)}
      </div>)}
  </SectionCard>;
}
