"use client";

import * as React from "react";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/form/submit-button";
import { type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { formatPartialRange, isValidPartialDateRange, type DatePrecision } from "@/lib/date-precision";
import { parsePlainDate } from "@/lib/dates";
import { AVAILABILITY_BADGES, type HappeningPhase } from "@/lib/happenings";
import { cn } from "@/lib/utils";
import { HappeningFields, type HappeningValue } from "../detail-field-groups";
import { createHappening, deleteHappening, updateHappening } from "@/server/actions/details";

export interface HappeningItemView extends HappeningValue {
  id: string;
  phase: HappeningPhase;
  type: { label: string; icon: string | null; color: string | null } | null;
}

/**
 * What this person has going on — the informal calendar you keep for someone
 * who has not shared a real one.
 *
 * Separate from significant moments (their history, which keeps forever) and
 * from things to do (plans you make *with* them). This is the trip they are
 * taking without you: worth knowing before, so you do not invite them to
 * something they will miss, and worth knowing after, so you remember to ask.
 */
const RANGE_ERROR = "End date must not be before the start date.";

function HappeningForm({
  action,
  formId,
  types,
  happening,
  contactId,
  children,
}: {
  action: (form: FormData) => void | Promise<void>;
  formId: string;
  types: TermOption[];
  happening?: HappeningItemView;
  contactId?: string;
  children: React.ReactNode;
}) {
  const [endDateError, setEndDateError] = React.useState<string>();

  // Mirrors the server check so a bad range is caught without a round trip.
  // The action re-validates regardless: it is a public POST endpoint.
  function validateRange(submission: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(submission.currentTarget);
    const start = parsePlainDate(String(data.get("date") ?? ""));
    const endRaw = String(data.get("endDate") ?? "");
    const end = endRaw ? parsePlainDate(endRaw) : null;
    if (!start || (endRaw && !end)) return;

    const valid = isValidPartialDateRange(
      { date: start, precision: String(data.get("datePrecision")) as DatePrecision },
      end ? { date: end, precision: String(data.get("endDatePrecision")) as DatePrecision } : null,
    );
    setEndDateError(valid ? undefined : RANGE_ERROR);
    if (!valid) submission.preventDefault();
  }

  return (
    <form action={action} onSubmit={validateRange} className="grid gap-2.5">
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {happening ? <input type="hidden" name="id" value={happening.id} /> : null}
      <HappeningFields
        formId={formId}
        types={types}
        happening={happening}
        endDateError={endDateError}
      />
      {children}
    </form>
  );
}

export function HappeningsSection({
  contactId,
  happenings,
  types,
}: {
  contactId: string;
  happenings: HappeningItemView[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();

  return (
    <SectionCard
      id="happenings"
      title="Going on in their life"
      icon="CalendarClock"
      count={happenings.length}
      addLabel="Add something they have on"
      form={(close) => (
        <HappeningForm
          action={add(createHappening, close, "Added")}
          formId="happening-new"
          types={types}
          contactId={contactId}
        >
          <SubmitButton size="sm">Add</SubmitButton>
        </HappeningForm>
      )}
    >
      {happenings.length === 0 ? (
        <SectionEmpty>
          Trips, deadlines, surgery, visitors staying—the things they mentioned in
          passing. Knowing beforehand saves inviting someone who is away, and
          knowing afterwards is how you remember to ask how it went.
        </SectionEmpty>
      ) : (
        happenings.map((happening) => {
          const badge = AVAILABILITY_BADGES[happening.availability];
          const past = happening.phase === "ended";
          return (
            <SectionRow
              key={happening.id}
              id={`happening-${happening.id}`}
              className={cn(past && "opacity-60")}
              onDelete={() => void run(() => deleteHappening(happening.id), "Removed")}
              deleteConfirm={`Delete “${happening.title}” from what this person has on?`}
              deleteLabel="Delete happening"
              editLabel="Edit happening"
              editForm={(close) => (
                <HappeningForm
                  action={edit(updateHappening, close, "Saved")}
                  formId={`happening-${happening.id}`}
                  types={types}
                  happening={happening}
                  contactId={contactId}
                >
                  <SubmitButton size="sm">Save</SubmitButton>
                </HappeningForm>
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {happening.type?.icon ? (
                  <Icon name={happening.type.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="min-w-0 truncate text-sm font-medium">{happening.title}</span>
                {badge ? <Badge variant="muted">{badge}</Badge> : null}
                {happening.isTentative ? <Badge variant="muted">Maybe</Badge> : null}
                {happening.phase === "ongoing" ? <Badge variant="muted">Now</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatPartialRange(
                  happening.date,
                  happening.precision,
                  happening.endDate,
                  happening.endPrecision,
                )}
                {happening.hasFollowUp ? " · follow-up on your task list" : ""}
              </p>
              {happening.notes ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{happening.notes}</p>
              ) : null}
              {happening.source ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Heard: {happening.source}
                </p>
              ) : null}
            </SectionRow>
          );
        })
      )}
    </SectionCard>
  );
}
