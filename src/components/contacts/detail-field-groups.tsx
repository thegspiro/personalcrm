"use client";

import { DateField } from "@/components/form/date-field";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import type { DatePrecision } from "@/lib/date-precision";
import { plainDateKey, type PlainDate } from "@/lib/dates";

export interface ImportantDateValue {
  label: string;
  date: PlainDate;
  precision: DatePrecision;
  recurrence: "NONE" | "ANNUAL" | "MONTHLY";
  typeId: string | null;
  notes: string | null;
  reminderDaysBefore: number[] | null;
}

export function ImportantDateFields({
  formId,
  types,
  item,
}: {
  formId: string;
  types: TermOption[];
  item?: ImportantDateValue;
}) {
  return (
    <>
      <Field label="What is it?" htmlFor={`${formId}-label`}>
        <Input id={`${formId}-label`} name="label" required defaultValue={item?.label ?? ""} placeholder="Wedding anniversary" />
      </Field>
      <DateField name="date" idPrefix={`${formId}-date`} label="When" required presets={[]} defaultValue={item ? plainDateKey(item.date) : undefined} defaultPrecision={item?.precision} />
      <TermSelect name="typeId" id={`${formId}-typeId`} label="Type" terms={types} defaultValue={item?.typeId} />
      <Field label="Repeats" htmlFor={`${formId}-recurrence`}>
        <select id={`${formId}-recurrence`} name="recurrence" defaultValue={item?.recurrence ?? "ANNUAL"} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm">
          <option value="ANNUAL">Every year</option>
          <option value="MONTHLY">Every month</option>
          <option value="NONE">Just once</option>
        </select>
      </Field>
      <Field label="Reminder days" htmlFor={`${formId}-reminders`} hint="Optional. For example: 30, 7, 0. Leave blank to use your account default.">
        <Input id={`${formId}-reminders`} name="reminderDaysBefore" inputMode="numeric" defaultValue={item?.reminderDaysBefore?.join(", ") ?? ""} placeholder="Account default" />
      </Field>
      <Field label="Notes" htmlFor={`${formId}-notes`}>
        <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={item?.notes ?? ""} />
      </Field>
    </>
  );
}

export interface LifeEventValue {
  title: string;
  description: string | null;
  typeId: string | null;
  date: PlainDate;
  precision: DatePrecision;
  endDate: PlainDate | null;
  endPrecision: DatePrecision | null;
  isMilestone: boolean;
}

export function LifeEventFields({ formId, types, event, resetEndDateKey, endDateError }: { formId: string; types: TermOption[]; event?: LifeEventValue; resetEndDateKey?: number; endDateError?: string }) {
  return (
    <>
      <Field label="What happened?" htmlFor={`${formId}-title`}>
        <Input id={`${formId}-title`} name="title" required defaultValue={event?.title ?? ""} placeholder="Moved to Austin" />
      </Field>
      <DateField name="date" idPrefix={`${formId}-date`} label="When" required presets={["lastYear"]} defaultValue={event ? plainDateKey(event.date) : undefined} defaultPrecision={event?.precision} hint="Only know the year? Set the precision to 'Year only'." />
      <DateField key={resetEndDateKey} name="endDate" idPrefix={`${formId}-endDate`} label="Until" presets={[]} defaultValue={event?.endDate ? plainDateKey(event.endDate) : undefined} defaultPrecision={event?.endPrecision ?? "DAY"} hint="Only for things that ran for a while — a job, a course, a city." error={endDateError} />
      <TermSelect name="typeId" id={`${formId}-typeId`} label="Type" terms={types} defaultValue={event?.typeId} />
      <Field label="Anything more?" htmlFor={`${formId}-description`}>
        <Textarea id={`${formId}-description`} name="description" rows={2} defaultValue={event?.description ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="isMilestone" value="true" defaultChecked={event?.isMilestone ?? false} className="size-4" />
        One of the big ones
      </label>
    </>
  );
}
