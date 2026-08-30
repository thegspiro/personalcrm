"use client";

import { Icon } from "@/components/nav/icon";
import { SubmitButton } from "@/components/form/submit-button";
import { type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { formatPartialDate, type DatePrecision } from "@/lib/date-precision";
import { type PlainDate } from "@/lib/dates";
import { reminderPolicyLabel, type ReminderPolicy } from "@/lib/reminders";
import { ContactBirthdayFields, ImportantDateFields, type ImportantDateValue } from "../detail-field-groups";
import { createImportantDate, deleteImportantDate, updateImportantDate } from "@/server/actions/details";
import { updateContactBirthday } from "@/server/actions/contacts";

export interface DateItem extends ImportantDateValue {
  id: string;
  label: string;
  date: PlainDate;
  precision: DatePrecision;
  recurrence: "NONE" | "ANNUAL" | "MONTHLY";
  typeId: string | null;
  notes: string | null;
  reminderDaysBefore: ReminderPolicy;
  type: { label: string; icon: string | null; color: string | null } | null;
  canonicalBirthday?: boolean;
}

export function DatesSection({
  contactId,
  dates,
  types,
}: {
  contactId: string;
  dates: DateItem[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Important dates"
      icon="CalendarDays"
      count={dates.length}
      addLabel="Add a date"
      form={(close) => (
        <form action={add(createImportantDate, close, "Date added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <ImportantDateFields formId="date-new" types={types} />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {dates.length === 0 ? (
        <SectionEmpty>No dates yet.</SectionEmpty>
      ) : (
        dates.map((item) => (
          <SectionRow
            key={item.id}
            id={`important-date-${item.id}`}
            onDelete={
              item.canonicalBirthday
                ? undefined
                : () => void run(() => deleteImportantDate(item.id), "Removed")
            }
            deleteConfirm={
              item.canonicalBirthday ? undefined : `Delete the important date “${item.label}”?`
            }
            deleteLabel={item.canonicalBirthday ? undefined : "Delete date"}
            editLabel="Edit date"
            editForm={(close) => (
              item.canonicalBirthday ? (
                <form
                  action={add(updateContactBirthday, close, "Birthday saved")}
                  className="grid gap-2.5"
                >
                  <input type="hidden" name="id" value={contactId} />
                  <ContactBirthdayFields formId={`date-${item.id}`} item={item} />
                  <SubmitButton size="sm">Save</SubmitButton>
                </form>
              ) : (
                <form action={add(updateImportantDate, close, "Saved")} className="grid gap-2.5">
                  <input type="hidden" name="id" value={item.id} />
                  <ImportantDateFields formId={`date-${item.id}`} types={types} item={item} />
                  <SubmitButton size="sm">Save</SubmitButton>
                </form>
              )
            )}
          >
            <div className="flex items-center gap-2">
              {item.type?.icon ? (
                <Icon name={item.type.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">{item.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatPartialDate(item.date, item.precision)}
              {item.recurrence === "ANNUAL" ? " · yearly" : item.recurrence === "MONTHLY" ? " · monthly" : ""}
            </p>
            <p className="text-xs text-muted-foreground">{reminderPolicyLabel(item.reminderDaysBefore)}</p>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
