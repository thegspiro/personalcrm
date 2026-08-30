"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  timelineDateLabel,
  reachedOutByLabel,
  sentimentLabel,
  termColorClasses,
  timeOfDay,
} from "@/lib/format";
import type { PlainDate } from "@/lib/dates";
import type { TimelineEntry } from "@/server/queries/timeline";
import { deleteInteraction } from "@/server/actions/interactions";
import {
  deleteImportantDate,
  deleteLifeEvent,
  updateImportantDate,
  updateLifeEvent,
} from "@/server/actions/details";
import { EditInteractionSheet } from "@/components/timeline/edit-interaction";
import { PrivateText } from "@/components/dating/private-text";
import {
  ContactBirthdayFields,
  ImportantDateFields,
  LifeEventFields,
  type DateItem,
  type LifeEventItem,
} from "@/components/contacts/contact-sections";
import { updateContactBirthday } from "@/server/actions/contacts";
import type { TermOption } from "@/components/form/term-select";
import { SubmitButton } from "@/components/form/submit-button";
import { useAddAction } from "@/components/form/use-action";

/**
 * The unified feed.
 *
 * Entries carry their own precision, so a life event known only to the year
 * renders as "2019" while an interaction renders as "3 days ago". A fuzzy date
 * never gets relative wording — "about 6 years ago" would imply a confidence
 * the record doesn't have.
 */
export function TimelineList({
  entries,
  today,
  timezone,
  showContacts = true,
  blurSensitive = false,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  dateTypes = [],
  lifeEventTypes = [],
}: {
  entries: TimelineEntry[];
  today: PlainDate;
  timezone: string;
  showContacts?: boolean;
  /** Blur notes on dates, matching the contact page's date log. */
  blurSensitive?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  dateTypes?: TermOption[];
  lifeEventTypes?: TermOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editingDetail, setEditingDetail] = React.useState<string | null>(null);
  const submit = useAddAction();

  if (entries.length === 0) {
    return <EmptyState icon={<Icon name="History" />} title={emptyTitle} description={emptyDescription} />;
  }

  async function remove(entry: TimelineEntry) {
    const wording = entry.kind === "life-event"
      ? `Permanently delete the life event “${entry.title}” from this person's history?`
      : entry.kind === "important-date"
        ? `Delete the important date “${entry.title}”?`
        : `Delete the interaction “${entry.title}”?`;
    if (!confirm(wording)) return;
    const result = entry.kind === "life-event"
      ? await deleteLifeEvent(entry.id)
      : entry.kind === "important-date"
        ? await deleteImportantDate(entry.id)
        : await deleteInteraction(entry.id);
    if (!result.ok) {
      toast.error(result.error ?? "Could not delete.");
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`}>
            <article
              id={`timeline-entry-${entry.kind}-${entry.id}`}
              tabIndex={-1}
              className={cn(
                "group relative flex gap-3 rounded-xl border border-border bg-card px-3 py-2.5 target:border-accent-9 target:ring-2 target:ring-accent-6",
                entry.upcoming && "border-dashed",
              )}
            >
              {/* The aria-label is the accessible name on its own. A duplicate
                  sr-only copy of the title inside would only add a second
                  rendering of the same text to the card. */}
              <Link
                href={entry.href}
                aria-label={`Open ${entry.title}`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                  termColorClasses(entry.term?.color),
                )}
              >
                <Icon name={entry.term?.icon ?? kindIcon(entry.kind)} className="size-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timelineDateLabel(entry.date, entry.precision, today)}
                  </span>
                  {/*
                    In the row rather than floated over its corner, and visible
                    without hovering. A phone has no hover, and these used to
                    sit on top of the date at zero opacity — invisible, still
                    tappable, and covering the one thing they overlapped.
                  */}
                  {entry.kind === "interaction" || entry.editable ? (
                    <span className="relative z-10 flex shrink-0 gap-0.5 self-start">
                      <button
                        type="button"
                        onClick={() => entry.kind === "interaction" ? setEditing(entry.id) : setEditingDetail(`${entry.kind}-${entry.id}`)}
                        aria-label={`Edit ${entry.title}`}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Icon name="Pencil" className="size-3.5" />
                      </button>
                      {entry.editable?.kind !== "contact-birthday" ? (
                        <button
                          type="button"
                          onClick={() => void remove(entry)}
                          aria-label={`Delete ${entry.title}`}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Icon name="X" className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {entry.upcoming ? <Badge variant="outline">Upcoming</Badge> : null}
                  {entry.term ? <span>{entry.term.label}</span> : null}
                  {entry.occurredAt && entry.precision === "DAY" ? (
                    <span>{timeOfDay(entry.occurredAt, timezone)}</span>
                  ) : null}
                  {entry.location ? <span className="truncate">{entry.location}</span> : null}
                  {reachedOutByLabel(entry.reachedOutBy) ? (
                    <span>{reachedOutByLabel(entry.reachedOutBy)}</span>
                  ) : null}
                  {sentimentLabel(entry.sentiment) ? (
                    <span>{sentimentLabel(entry.sentiment)}</span>
                  ) : null}
                  {entry.precision !== "DAY" ? (
                    <span className="italic" title="Only known approximately">
                      approximate
                    </span>
                  ) : null}
                </div>

                {showContacts && entry.contacts.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {entry.contacts.map((contact) => (
                      <Link
                        key={contact.id}
                        href={`/people/${contact.id}`}
                        className="relative z-10 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        {displayName(contact)}
                      </Link>
                    ))}
                  </div>
                ) : null}

                {entry.detail ? (
                  entry.sensitive && blurSensitive ? (
                    <PrivateText className="mt-1 block whitespace-pre-line text-xs text-muted-foreground">
                      {entry.detail}
                    </PrivateText>
                  ) : (
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {entry.detail}
                    </p>
                  )
                ) : null}
              </div>
            </article>
            {editingDetail === `${entry.kind}-${entry.id}` && entry.editable ? (
              <div className="mt-2 rounded-xl border border-accent-8 bg-card p-3">
                {entry.editable.kind === "contact-birthday" ? (
                  <form action={submit(updateContactBirthday, () => setEditingDetail(null), "Birthday saved")} className="grid gap-2.5">
                    <input type="hidden" name="id" value={entry.editable.contactId} />
                    <ContactBirthdayFields
                      formId={`timeline-birthday-${entry.editable.contactId}`}
                      item={{ date: entry.date, precision: entry.precision }}
                    />
                    <SubmitButton size="sm">Save</SubmitButton>
                  </form>
                ) : entry.editable.kind === "important-date" ? (
                  <form action={submit(updateImportantDate, () => setEditingDetail(null), "Saved")} className="grid gap-2.5">
                    <input type="hidden" name="id" value={entry.id} />
                    <ImportantDateFields formId={`timeline-date-${entry.id}`} types={dateTypes} item={{
                      id: entry.id, label: entry.title, date: entry.date, precision: entry.precision,
                      recurrence: entry.editable.recurrence, typeId: entry.editable.typeId,
                      notes: entry.editable.notes,
                      reminderDaysBefore: entry.editable.reminderDaysBefore,
                      type: entry.term ?? null,
                    } satisfies DateItem} />
                    <SubmitButton size="sm">Save</SubmitButton>
                  </form>
                ) : (
                  <form action={submit(updateLifeEvent, () => setEditingDetail(null), "Saved")} className="grid gap-2.5">
                    <input type="hidden" name="id" value={entry.id} />
                    <LifeEventFields formId={`timeline-event-${entry.id}`} types={lifeEventTypes} event={{
                      id: entry.id, title: entry.title, description: entry.editable.description,
                      typeId: entry.editable.typeId, date: entry.date, precision: entry.precision,
                      endDate: entry.editable.endDate, endPrecision: entry.editable.endPrecision,
                      isMilestone: entry.editable.isMilestone, type: entry.term ?? null,
                    } satisfies LifeEventItem} />
                    <SubmitButton size="sm">Save</SubmitButton>
                  </form>
                )}
                <button type="button" onClick={() => setEditingDetail(null)} className="mt-2 w-full text-xs text-muted-foreground">Cancel</button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {/*
        Keyed on the row so each edit starts from a clean mount: no clearing
        the previous record by hand, and no chance of the last row's values
        showing through while the next one loads.
      */}
      <EditInteractionSheet
        key={editing ?? "none"}
        interactionId={editing}
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      />
    </>
  );
}

function kindIcon(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "life-event":
      return "Milestone";
    case "important-date":
      return "CalendarDays";
    case "gift":
      return "Gift";
    default:
      return "MessageSquare";
  }
}
