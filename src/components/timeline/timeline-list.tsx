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
import { EditInteractionSheet } from "@/components/timeline/edit-interaction";
import { PrivateText } from "@/components/dating/private-text";

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
}: {
  entries: TimelineEntry[];
  today: PlainDate;
  timezone: string;
  showContacts?: boolean;
  /** Blur notes on dates, matching the contact page's date log. */
  blurSensitive?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | null>(null);

  if (entries.length === 0) {
    return <EmptyState icon={<Icon name="History" />} title={emptyTitle} description={emptyDescription} />;
  }

  async function remove(entry: TimelineEntry) {
    if (entry.kind !== "interaction") return;
    if (!confirm("Delete this interaction?")) return;
    const result = await deleteInteraction(entry.id);
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
              className={cn(
                "group relative flex gap-3 rounded-xl border border-border bg-card px-3 py-2.5",
                entry.upcoming && "border-dashed",
              )}
            >
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
                  {entry.kind === "interaction" ? (
                    <span className="flex shrink-0 gap-0.5 self-start">
                      <button
                        type="button"
                        onClick={() => setEditing(entry.id)}
                        aria-label={`Edit ${entry.title}`}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Icon name="Pencil" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        aria-label={`Delete ${entry.title}`}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Icon name="X" className="size-3.5" />
                      </button>
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
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
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
