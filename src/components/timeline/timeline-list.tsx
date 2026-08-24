"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { timelineDateLabel, sentimentLabel, termColorClasses, timeOfDay } from "@/lib/format";
import type { PlainDate } from "@/lib/dates";
import type { TimelineEntry } from "@/server/queries/timeline";
import { deleteInteraction } from "@/server/actions/interactions";

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
  emptyTitle = "Nothing here yet",
  emptyDescription,
}: {
  entries: TimelineEntry[];
  today: PlainDate;
  timezone: string;
  showContacts?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const router = useRouter();

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
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {entry.upcoming ? <Badge variant="outline">Upcoming</Badge> : null}
                {entry.term ? <span>{entry.term.label}</span> : null}
                {entry.occurredAt && entry.precision === "DAY" ? (
                  <span>{timeOfDay(entry.occurredAt, timezone)}</span>
                ) : null}
                {entry.location ? <span className="truncate">{entry.location}</span> : null}
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
                <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                  {entry.detail}
                </p>
              ) : null}
            </div>

            {entry.kind === "interaction" ? (
              <button
                type="button"
                onClick={() => void remove(entry)}
                aria-label="Delete interaction"
                className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <span aria-hidden>×</span>
              </button>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
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
