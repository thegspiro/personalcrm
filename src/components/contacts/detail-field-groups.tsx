"use client";

import * as React from "react";
import { DateField } from "@/components/form/date-field";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import type { DatePrecision } from "@/lib/date-precision";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import type { ReminderPolicy } from "@/lib/reminders";
import {
  AVAILABILITY_IMPACTS,
  AVAILABILITY_LABELS,
  type AvailabilityImpact,
} from "@/lib/happenings";
import { cn } from "@/lib/utils";

export interface ImportantDateValue {
  label: string;
  date: PlainDate;
  precision: DatePrecision;
  recurrence: "NONE" | "ANNUAL" | "MONTHLY";
  typeId: string | null;
  notes: string | null;
  reminderDaysBefore: ReminderPolicy;
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
  const policy = item?.reminderDaysBefore;
  const reminderMode = policy === null || policy === undefined
    ? "default"
    : policy.length === 0
      ? "disabled"
      : policy.length === 1 && policy[0] === 0
        ? "on-day"
        : policy.length === 1 && policy[0] === 7
          ? "week"
          : policy.length === 1 && policy[0] === 30
            ? "month"
            : "custom";
  return (
    <>
      <Field label="What is it?" htmlFor={`${formId}-label`}>
        <Input
          id={`${formId}-label`}
          name="label"
          required
          defaultValue={item?.label ?? ""}
          placeholder="Wedding anniversary"
        />
      </Field>
      <DateField
        name="date"
        idPrefix={`${formId}-date`}
        label="When"
        required
        presets={[]}
        defaultValue={item ? plainDateKey(item.date) : undefined}
        defaultPrecision={item?.precision}
      />
      <TermSelect
        name="typeId"
        id={`${formId}-typeId`}
        label="Type"
        terms={types}
        defaultValue={item?.typeId}
      />
      <Field label="Repeats" htmlFor={`${formId}-recurrence`}>
        <select
          id={`${formId}-recurrence`}
          name="recurrence"
          defaultValue={item?.recurrence ?? "ANNUAL"}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="ANNUAL">Every year</option>
          <option value="MONTHLY">Every month</option>
          <option value="NONE">Just once</option>
        </select>
      </Field>
      <Field label="Reminder timing" htmlFor={`${formId}-reminderMode`}>
        <select
          id={`${formId}-reminderMode`}
          name="reminderMode"
          defaultValue={reminderMode}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="default">Use my account default (1 week before and on the day)</option>
          <option value="on-day">On the day</option>
          <option value="week">1 week before</option>
          <option value="month">1 month before</option>
          <option value="custom">Custom offsets</option>
          <option value="disabled">Do not remind me</option>
        </select>
      </Field>
      <Field
        label="Custom days before"
        htmlFor={`${formId}-reminderDaysBefore`}
        hint="Comma-separated. Use 0 for “On the day,” 7 for “1 week before,” or 30 for “1 month before.”"
      >
        <Input
          id={`${formId}-reminderDaysBefore`}
          name="reminderDaysBefore"
          inputMode="numeric"
          defaultValue={item?.reminderDaysBefore?.join(", ") ?? "7, 0"}
          placeholder="30, 7, 0"
        />
      </Field>
      <Field label="Notes" htmlFor={`${formId}-notes`}>
        <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={item?.notes ?? ""} />
      </Field>
    </>
  );
}

/** The canonical birthday field shared by the person row and timeline editor. */
export function ContactBirthdayFields({
  formId,
  item,
}: {
  formId: string;
  item: Pick<ImportantDateValue, "date" | "precision">;
}) {
  return (
    <>
      <DateField
        name="birthDate"
        idPrefix={`${formId}-birthday`}
        label="Birthday"
        required
        presets={[]}
        defaultValue={plainDateKey(item.date)}
        defaultPrecision={item.precision}
      />
      <p className="text-xs text-muted-foreground">
        Birthday is stored on this person and repeats every year.
      </p>
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

export interface HappeningValue {
  title: string;
  date: PlainDate;
  precision: DatePrecision;
  endDate: PlainDate | null;
  endPrecision: DatePrecision | null;
  typeId: string | null;
  notes: string | null;
  source: string | null;
  availability: AvailabilityImpact;
  isTentative: boolean;
  hasFollowUp: boolean;
}

/**
 * Adding and correcting something the other person has on.
 *
 * Availability is a chip row rather than a dropdown, matching the rest of the
 * short enum pickers here: the list is three long, and one tap beats
 * open-scroll-tap on a phone.
 *
 * Every field the row renders is offered, because `updateHappening` writes all
 * of them — a form missing the follow-up box would silently cancel the reminder
 * every time you fixed a typo.
 */
export function HappeningFields({
  formId,
  types,
  happening,
  endDateError,
}: {
  formId: string;
  types: TermOption[];
  happening?: HappeningValue;
  endDateError?: string;
}) {
  const [availability, setAvailability] = React.useState<AvailabilityImpact>(
    happening?.availability ?? "NONE",
  );

  return (
    <>
      <Field label="What have they got on?" htmlFor={`${formId}-title`}>
        <Input
          id={`${formId}-title`}
          name="title"
          required
          defaultValue={happening?.title ?? ""}
          placeholder="Trip to Portugal"
        />
      </Field>
      <DateField
        name="date"
        idPrefix={`${formId}-date`}
        label="When"
        required
        presets={["today"]}
        defaultValue={happening ? plainDateKey(happening.date) : undefined}
        defaultPrecision={happening?.precision}
        hint="Only know the month? Set the precision to 'Month' rather than guessing a day."
      />
      <DateField
        name="endDate"
        idPrefix={`${formId}-endDate`}
        label="Until"
        presets={[]}
        defaultValue={happening?.endDate ? plainDateKey(happening.endDate) : undefined}
        defaultPrecision={happening?.endPrecision ?? "DAY"}
        hint="Only for things that run for a while — a trip, a busy fortnight."
        error={endDateError}
      />
      <TermSelect
        name="typeId"
        id={`${formId}-typeId`}
        label="Type"
        terms={types}
        defaultValue={happening?.typeId}
      />

      <input type="hidden" name="availability" value={availability} />
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Are they free?</span>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_IMPACTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={availability === option}
              onClick={() => setAvailability(option)}
              className={cn(
                "min-h-9 rounded-full border px-3 py-1 text-xs transition-colors",
                availability === option
                  ? "border-accent-8 bg-accent-3 text-accent-11"
                  : "border-border hover:bg-muted",
              )}
            >
              {AVAILABILITY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <Field label="How did you hear?" htmlFor={`${formId}-source`}>
        <Input
          id={`${formId}-source`}
          name="source"
          defaultValue={happening?.source ?? ""}
          placeholder="Mentioned it at dinner"
        />
      </Field>
      <Field label="Anything more?" htmlFor={`${formId}-notes`}>
        <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={happening?.notes ?? ""} />
      </Field>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="isTentative"
          value="true"
          defaultChecked={happening?.isTentative ?? false}
          className="size-4"
        />
        Not certain — they might not be doing this
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="followUp"
          value="true"
          defaultChecked={happening?.hasFollowUp ?? false}
          className="size-4"
        />
        Remind me to ask how it went
      </label>
    </>
  );
}
