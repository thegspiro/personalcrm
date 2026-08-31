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
  ALLERGY_CATEGORIES,
  ALLERGY_CATEGORY_LABELS,
  ALLERGY_STATUSES,
  ALLERGY_STATUS_LABELS,
  DIETARY_KINDS,
  DIETARY_KIND_LABELS,
  mustAvoid,
  type AllergyCategory,
  type AllergyStatus,
  type DietaryKind,
} from "@/lib/dietary";
import {
  createDietaryNeed,
  deleteDietaryNeed,
  updateAllergyStatus,
  updateDietaryNeed,
} from "@/server/actions/details";

export interface DietaryItem {
  id: string;
  kind: DietaryKind;
  category: AllergyCategory;
  label: string;
  notes: string | null;
  reaction: string | null;
  carriesEpinephrine: boolean;
  epinephrineLocation: string | null;
  emergencyInstructions: string | null;
  professionallyDiagnosed: boolean | null;
  lastConfirmedOn: string | null;
}

const DIETARY_ONLY_KINDS = DIETARY_KINDS.filter((kind) => kind !== "ALLERGY");

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  labels,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}
            className={cn("min-h-9 rounded-full border px-3 py-1 text-xs transition-colors",
              value === option ? "border-accent-8 bg-accent-3 text-accent-11" : "border-border hover:bg-muted")}
          >{labels[option]}</button>
        ))}
      </div>
    </div>
  );
}

function NeedFields({ formId, need, allergy }: { formId: string; need?: DietaryItem; allergy: boolean }) {
  const [kind, setKind] = React.useState<DietaryKind>(need?.kind ?? (allergy ? "ALLERGY" : "INTOLERANCE"));
  const [category, setCategory] = React.useState<AllergyCategory>(need?.category ?? "FOOD");
  const isAllergy = kind === "ALLERGY";
  const prompt = isAllergy
    ? category === "FOOD" ? "What food are they allergic to?"
      : category === "MEDICATION" ? "Which medication are they allergic to?"
        : "What are they allergic to?"
    : kind === "PREFERENCE" ? "What do they prefer to avoid?" : "What can't they have?";
  const placeholder = isAllergy
    ? category === "FOOD" ? "Shellfish" : category === "MEDICATION" ? "Penicillin" : category === "ENVIRONMENTAL" ? "Pollen" : "Latex"
    : kind === "INTOLERANCE" ? "Lactose" : kind === "MEDICAL" ? "High-sodium food" : "Mushrooms";

  return <>
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="category" value={isAllergy ? category : "FOOD"} />
    <ChoiceRow label="Entry type" options={allergy || need ? DIETARY_KINDS : DIETARY_ONLY_KINDS} value={kind} labels={DIETARY_KIND_LABELS} onChange={setKind} />
    {isAllergy ? <ChoiceRow label="Allergy category" options={ALLERGY_CATEGORIES} value={category} labels={ALLERGY_CATEGORY_LABELS} onChange={setCategory} /> : null}
    <Field label={prompt} htmlFor={`${formId}-label`}>
      <Input id={`${formId}-label`} name="label" required defaultValue={need?.label ?? ""} placeholder={placeholder} />
    </Field>
    {isAllergy ? <>
      <Field label="What happens? (optional)" htmlFor={`${formId}-reaction`} hint="Record facts such as hives or difficulty breathing; do not predict severity.">
        <Textarea id={`${formId}-reaction`} name="reaction" rows={2} defaultValue={need?.reaction ?? ""} placeholder="Hives and swelling" />
      </Field>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="carriesEpinephrine" value="true" defaultChecked={need?.carriesEpinephrine ?? false} className="size-4" />
        Carries adrenaline for this allergy
      </label>
      <Field label="Where is it kept? (optional)" htmlFor={`${formId}-epinephrineLocation`}>
        <Input id={`${formId}-epinephrineLocation`} name="epinephrineLocation" defaultValue={need?.epinephrineLocation ?? ""} placeholder="Front pocket of backpack" />
      </Field>
      <Field label="Emergency instructions (optional)" htmlFor={`${formId}-emergencyInstructions`}>
        <Textarea id={`${formId}-emergencyInstructions`} name="emergencyInstructions" rows={2} defaultValue={need?.emergencyInstructions ?? ""} />
      </Field>
      <Field label="Professionally diagnosed?" htmlFor={`${formId}-diagnosed`}>
        <select id={`${formId}-diagnosed`} name="professionallyDiagnosed" defaultValue={need?.professionallyDiagnosed == null ? "unknown" : need.professionallyDiagnosed ? "yes" : "no"} className="min-h-9 rounded-md border bg-background px-3 text-sm">
          <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      </Field>
      <Field label="Last confirmed (optional)" htmlFor={`${formId}-lastConfirmedOn`}>
        <Input id={`${formId}-lastConfirmedOn`} name="lastConfirmedOn" type="date" defaultValue={need?.lastConfirmedOn ?? ""} />
      </Field>
    </> : null}
    <Field label="Anything else worth knowing?" htmlFor={`${formId}-notes`}>
      <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={need?.notes ?? ""} />
    </Field>
  </>;
}

function NeedRow({ need, allergy }: { need: DietaryItem; allergy: boolean }) {
  const run = useAction();
  const add = useAddAction();
  return <SectionRow className={allergy || mustAvoid(need.kind) ? "border-destructive/40 bg-destructive/5" : undefined}
    onDelete={() => void run(() => deleteDietaryNeed(need.id), "Removed")}
    deleteLabel={`Remove ${allergy ? "allergy" : "dietary need"}`} editLabel={`Edit ${allergy ? "allergy" : "dietary need"}`}
    editForm={(close) => <form action={add(updateDietaryNeed, close, "Saved")} className="grid gap-2.5">
      <input type="hidden" name="id" value={need.id} /><NeedFields formId={`need-${need.id}`} need={need} allergy={allergy} /><SubmitButton size="sm">Save</SubmitButton>
    </form>}>
    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{need.label}</span>
      <span className="text-[11px] text-muted-foreground">{allergy ? ALLERGY_CATEGORY_LABELS[need.category] : DIETARY_KIND_LABELS[need.kind]}</span>
      {need.carriesEpinephrine ? <Badge variant="destructive" className="text-[10px]">Carries adrenaline</Badge> : null}
    </div>
    {need.reaction ? <p className="mt-1 text-xs"><strong>Reaction:</strong> {need.reaction}</p> : null}
    {need.epinephrineLocation ? <p className="text-xs"><strong>Adrenaline:</strong> {need.epinephrineLocation}</p> : null}
    {need.emergencyInstructions ? <p className="whitespace-pre-line text-xs"><strong>Emergency:</strong> {need.emergencyInstructions}</p> : null}
    {need.notes ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{need.notes}</p> : null}
  </SectionRow>;
}

export function DietarySection({ contactId, needs, allergyStatus }: { contactId: string; needs: DietaryItem[]; allergyStatus: AllergyStatus }) {
  const add = useAddAction();
  const run = useAction();
  const allergies = needs.filter((need) => need.kind === "ALLERGY");
  const dietary = needs.filter((need) => need.kind !== "ALLERGY");
  return <>
    <style>{`@media print {
      body * { visibility: hidden; }
      #allergies, #allergies * { visibility: visible; }
      #allergies { position: absolute; inset: 0; }
    }`}</style>
    <div id="allergies" className="contents">
    <SectionCard title="Allergies" icon="ShieldAlert" count={allergies.length} addLabel="Add an allergy"
      form={(close) => <form action={add(createDietaryNeed, close, "Allergy noted")} className="grid gap-2.5"><input type="hidden" name="contactId" value={contactId} /><NeedFields formId="allergy-new" allergy /><SubmitButton size="sm">Add allergy</SubmitButton></form>}>
      <form action={(form) => void run(() => updateAllergyStatus(form), "Allergy status updated")} className="flex flex-wrap items-end gap-2 print:hidden">
        <input type="hidden" name="contactId" value={contactId} />
        <Field label="Allergy status" htmlFor="allergy-status"><select id="allergy-status" name="allergyStatus" defaultValue={allergyStatus} className="min-h-9 rounded-md border bg-background px-3 text-sm">{ALLERGY_STATUSES.map((status) => <option key={status} value={status}>{ALLERGY_STATUS_LABELS[status]}</option>)}</select></Field>
        <SubmitButton size="sm">Update status</SubmitButton><button type="button" onClick={() => window.print()} className="min-h-9 rounded-md border px-3 text-xs">Print emergency summary</button>
      </form>
      <p className="hidden text-sm font-medium print:block">{ALLERGY_STATUS_LABELS[allergyStatus]}</p>
      {allergies.length === 0 ? <SectionEmpty>{ALLERGY_STATUS_LABELS[allergyStatus]}</SectionEmpty> : allergies.map((need) => <NeedRow key={need.id} need={need} allergy />)}
    </SectionCard></div>
    <SectionCard title="Food and dietary needs" icon="UtensilsCrossed" count={dietary.length} addLabel="Add a dietary need"
      form={(close) => <form action={add(createDietaryNeed, close, "Dietary need noted")} className="grid gap-2.5"><input type="hidden" name="contactId" value={contactId} /><NeedFields formId="diet-new" allergy={false} /><SubmitButton size="sm">Add dietary need</SubmitButton></form>}>
      {dietary.length === 0 ? <SectionEmpty>No intolerances, medical restrictions, or preferences noted.</SectionEmpty> : dietary.map((need) => <NeedRow key={need.id} need={need} allergy={false} />)}
    </SectionCard>
  </>;
}
