"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/form/submit-button";
import { type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { formatPartialRange, isValidPartialDateRange, type DatePrecision } from "@/lib/date-precision";
import { parsePlainDate } from "@/lib/dates";
import { LifeEventFields, type LifeEventValue } from "../detail-field-groups";
import { createLifeEvent, deleteLifeEvent, updateLifeEvent } from "@/server/actions/details";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { displayName } from "@/lib/utils";

export interface LifeEventItem extends LifeEventValue {
  id: string;
  type: { label: string; icon: string | null; color: string | null } | null;
  isPrivate: boolean;
  participants: PickerContact[];
}

/**
 * Things that happened to them. Separate from interactions because you weren't
 * necessarily there, and separate from important dates because you don't want a
 * yearly reminder about someone's bereavement.
 */
/**
 * Adding a life event and correcting one.
 *
 * The end date and the milestone marker are here because the row renders both
 * and `updateLifeEvent` writes both: a form that offered neither would clear a
 * backfilled range and demote a milestone every time you fixed a spelling.
 */
const LIFE_EVENT_RANGE_ERROR = "End date must not be before the start date.";

function LifeEventForm({
  action,
  formId,
  types,
  event,
  contactId,
  contacts,
  children,
}: {
  action: (form: FormData) => void | Promise<void>;
  formId: string;
  types: TermOption[];
  event?: LifeEventItem;
  contactId?: string;
  contacts: PickerContact[];
  children: React.ReactNode;
}) {
  const [endDateError, setEndDateError] = React.useState<string>();

  function validateRange(submission: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(submission.currentTarget);
    const start = parsePlainDate(String(data.get("date") ?? ""));
    const endRaw = String(data.get("endDate") ?? "");
    const end = endRaw ? parsePlainDate(endRaw) : null;
    if (!start || (endRaw && !end)) return;

    const valid = isValidPartialDateRange(
      { date: start, precision: String(data.get("datePrecision")) as DatePrecision },
      end
        ? { date: end, precision: String(data.get("endDatePrecision")) as DatePrecision }
        : null,
    );
    setEndDateError(valid ? undefined : LIFE_EVENT_RANGE_ERROR);
    if (!valid) submission.preventDefault();
  }

  return (
    <form action={action} onSubmit={validateRange} className="grid gap-2.5">
      {event ? <input type="hidden" name="id" value={event.id} /> : null}
      <ContactPicker name="contactIds" label="Participants" contacts={contacts} required
        defaultSelected={event?.participants.map((person) => person.id) ?? (contactId ? [contactId] : [])} />
      <LifeEventFields formId={formId} types={types} event={event} endDateError={endDateError} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Spouse (for a dated “Got married” event)
        <select name="spouseContactId" defaultValue="" className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground">
          <option value="">Choose the spouse explicitly</option>
          {contacts.filter((person) => person.id !== contactId).map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}
        </select>
        <span>This adds the spouse as a participant and maintains the separate, ongoing spouse relationship.</span>
      </label>
      {children}
    </form>
  );
}

export function LifeEventsSection({
  contactId,
  events,
  types,
  contacts,
}: {
  contactId: string;
  events: LifeEventItem[];
  types: TermOption[];
  contacts: PickerContact[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      id="life-events"
      title="Significant moments"
      icon="Milestone"
      count={events.length}
      addLabel="Add a significant moment"
      form={(close) => (
        <LifeEventForm
          action={add(createLifeEvent, close, "Event added")}
          formId="event-new"
          types={types}
          contactId={contactId}
          contacts={contacts}
        >
          <SubmitButton size="sm">Add</SubmitButton>
        </LifeEventForm>
      )}
    >
      {events.length === 0 ? (
        <SectionEmpty>
          Record the moments that shaped their life—moves, achievements, relationships,
          recoveries, and memories worth keeping.
        </SectionEmpty>
      ) : (
        events.map((event) => (
          <SectionRow
            key={event.id}
            id={`life-event-${event.id}`}
            onDelete={() => void run(() => deleteLifeEvent(event.id), "Removed")}
            deleteConfirm={`Permanently delete the life event “${event.title}” from this person's history?`}
            deleteLabel="Delete life event"
            editLabel="Edit life event"
            editForm={(close) => (
              <LifeEventForm
                action={add(updateLifeEvent, close, "Saved")}
                formId={`event-${event.id}`}
                types={types}
                event={event}
                contacts={contacts}
              >
                <SubmitButton size="sm">Save</SubmitButton>
              </LifeEventForm>
            )}
          >
            <div className="flex items-center gap-2">
              {event.type?.icon ? (
                <Icon name={event.type.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">{event.title}</span>
              {event.isMilestone ? <Badge variant="muted">Milestone</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatPartialRange(event.date, event.precision, event.endDate, event.endPrecision)}
            </p>
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {event.participants.map((person) => (
                <Link key={person.id} href={`/people/${person.id}`} className="underline-offset-2 hover:underline">{displayName(person)}</Link>
              ))}
            </p>
            {event.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
            ) : null}
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
