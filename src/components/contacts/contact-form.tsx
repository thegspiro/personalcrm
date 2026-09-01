"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/form/submit-button";
import {
  CustomFieldInputs,
  type RenderableField,
} from "@/components/custom-fields/field-renderer";
import { DateField } from "@/components/form/date-field";
import { TermChips, TermSelect, type TermOption } from "@/components/form/term-select";
import { CADENCE_PRESETS } from "@/lib/cadence";
import { createContact, updateContact } from "@/server/actions/contacts";
import type { ActionResult } from "@/server/actions/helpers";

export interface ContactFormValues {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  pronouns: string | null;
  categoryId: string | null;
  occupation: string | null;
  employer: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  summary: string | null;
  howWeMet: string | null;
  whereWeMet: string | null;
  meetingSourceId: string | null;
  birthDate: string | null;
  birthDatePrecision: "DAY" | "MONTH" | "YEAR" | "MONTH_DAY";
  metOn: string | null;
  metOnPrecision: "DAY" | "MONTH" | "YEAR" | "MONTH_DAY";
  cadenceDays: number | null;
  isFavorite: boolean;
  isRomantic: boolean;
}

export function ContactForm({
  categories,
  meetingSources,
  contact,
  defaultCadenceDays,
  customFields = [],
}: {
  categories: TermOption[];
  meetingSources: TermOption[];
  contact?: ContactFormValues;
  defaultCadenceDays?: number | null;
  /** Fields you defined yourself, already scoped to this contact's category. */
  customFields?: RenderableField[];
}) {
  const router = useRouter();
  const [state, setState] = React.useState<ActionResult<{ id: string }>>({ ok: true });
  const editing = Boolean(contact);

  async function onSubmit(form: FormData) {
    const result = editing ? await updateContact(form) : await createContact(form);
    setState(result as ActionResult<{ id: string }>);

    if (!result.ok) return;
    toast.success(editing ? "Saved" : "Added");

    const id = editing ? contact!.id : (result as ActionResult<{ id: string }>).data?.id;
    router.push(id ? `/people/${id}` : "/people");
    router.refresh();
  }

  return (
    <form action={onSubmit} className="grid gap-4">
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Card>
        <CardContent className="grid gap-3.5 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" error={state.fieldErrors?.firstName}>
              <Input
                id="firstName"
                name="firstName"
                required
                autoFocus={!editing}
                defaultValue={contact?.firstName ?? ""}
                placeholder="Sarah"
              />
            </Field>
            <Field label="Last name" htmlFor="lastName">
              <Input
                id="lastName"
                name="lastName"
                defaultValue={contact?.lastName ?? ""}
                placeholder="Whitfield"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Goes by" htmlFor="nickname">
              <Input id="nickname" name="nickname" defaultValue={contact?.nickname ?? ""} />
            </Field>
            <Field label="Pronouns" htmlFor="pronouns">
              <Input
                id="pronouns"
                name="pronouns"
                defaultValue={contact?.pronouns ?? ""}
                placeholder="she/her"
              />
            </Field>
          </div>

          <TermChips
            name="categoryId"
            label="How do you know them?"
            terms={categories}
            defaultValue={contact?.categoryId}
            emptyLabel="Unsorted"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3.5 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job" htmlFor="occupation">
              <Input id="occupation" name="occupation" defaultValue={contact?.occupation ?? ""} />
            </Field>
            <Field label="Company" htmlFor="employer">
              <Input id="employer" name="employer" defaultValue={contact?.employer ?? ""} />
            </Field>
          </div>

          {/*
            Region and country are written by the action on every save, so
            leaving them off the form did not merely leave them empty -- editing
            a contact wrote null over whatever was there.
          */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" defaultValue={contact?.city ?? ""} maxLength={120} />
            </Field>
            <Field label="Region" htmlFor="region">
              <Input id="region" name="region" defaultValue={contact?.region ?? ""} maxLength={120} />
            </Field>
            <Field label="Country" htmlFor="country">
              <Input id="country" name="country" defaultValue={contact?.country ?? ""} maxLength={120} />
            </Field>
          </div>

          <DateField
            name="birthDate"
            label="Birthday"
            defaultValue={contact?.birthDate}
            defaultPrecision={contact?.birthDatePrecision ?? "MONTH_DAY"}
            presets={[]}
            hint="Set the precision to 'day and month' if you don't know the year."
          />

          <Field label="Anything worth knowing up front" htmlFor="summary">
            <Textarea
              id="summary"
              name="summary"
              rows={3}
              defaultValue={contact?.summary ?? ""}
              placeholder="A sentence or two you'd want to remember."
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3.5 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            How you met
          </p>

          <DateField
            name="metOn"
            label="When"
            defaultValue={contact?.metOn}
            defaultPrecision={contact?.metOnPrecision ?? "DAY"}
            presets={["today", "lastMonth", "lastYear"]}
            hint="A year on its own is fine if that's all you remember."
          />

          <TermSelect
            name="meetingSourceId"
            label="Where"
            terms={meetingSources}
            defaultValue={contact?.meetingSourceId}
            placeholder="Not sure"
          />

          <Field
            label="The place"
            htmlFor="whereWeMet"
            hint="The room, not the category — “Kellogg's on Fifth”, “Priya's housewarming”."
          >
            <Input
              id="whereWeMet"
              name="whereWeMet"
              maxLength={191}
              defaultValue={contact?.whereWeMet ?? ""}
              placeholder="Ronnie's, in the back room"
            />
          </Field>

          <Field label="The story" htmlFor="howWeMet">
            <Textarea
              id="howWeMet"
              name="howWeMet"
              rows={2}
              defaultValue={contact?.howWeMet ?? ""}
              placeholder="Roommates our sophomore year."
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3.5 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Keeping in touch
          </p>

          <Field
            label="Remind me to reach out"
            htmlFor="cadenceDays"
            hint="You'll show up on the home screen when it's been this long."
          >
            <select
              id="cadenceDays"
              name="cadenceDays"
              defaultValue={String(contact?.cadenceDays ?? defaultCadenceDays ?? "")}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs"
            >
              {CADENCE_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.days ?? ""}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <ToggleRow
            name="isFavorite"
            label="Favourite"
            description="Pin them near the top of your lists."
            defaultChecked={contact?.isFavorite ?? false}
          />
          <ToggleRow
            name="isRomantic"
            label="Dating or interested"
            description="Adds the dating profile, pipeline, and date log."
            defaultChecked={contact?.isRomantic ?? false}
          />
        </CardContent>
      </Card>

      {customFields.length > 0 ? (
        <Card>
          <CardContent className="grid gap-3.5 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your own fields
            </p>
            <CustomFieldInputs fields={customFields} errors={state.fieldErrors} />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2 pb-2">
        <SubmitButton className="flex-1">{editing ? "Save changes" : "Add person"}</SubmitButton>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ToggleRow({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  const [checked, setChecked] = React.useState(defaultChecked);
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <input type="hidden" name={name} value={checked ? "true" : "false"} />
      <Switch checked={checked} onCheckedChange={setChecked} />
    </label>
  );
}
