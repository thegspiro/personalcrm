"use client";

import * as React from "react";
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

export interface LifeEventItem extends LifeEventValue {
  id: string;
  type: { label: string; icon: string | null; color: string | null } | null;
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
  children,
}: {
  action: (form: FormData) => void | Promise<void>;
  formId: string;
  types: TermOption[];
  event?: LifeEventItem;
  contactId?: string;
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
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {event ? <input type="hidden" name="id" value={event.id} /> : null}
      <LifeEventFields formId={formId} types={types} event={event} endDateError={endDateError} />
      {children}
    </form>
  );
}

export function LifeEventsSection({
  contactId,
  events,
  types,
}: {
  contactId: string;
  events: LifeEventItem[];
  types: TermOption[];
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
            {event.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
            ) : null}
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
