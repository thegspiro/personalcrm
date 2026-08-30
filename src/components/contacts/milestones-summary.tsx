import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import { formatPartialRange } from "@/lib/date-precision";
import type { LifeEventItem } from "./sections/life-events";

export function MilestonesSummary({ milestones }: { milestones: LifeEventItem[] }) {
  if (milestones.length === 0) return null;

  return (
    <section className="min-w-0 rounded-xl border border-accent-7/60 bg-accent-2/40 px-4 py-3">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <Icon name="Milestone" className="size-4 shrink-0 text-accent-11" />
        <h2 className="truncate text-sm font-semibold">Milestones</h2>
        <Link
          href="#life-events"
          className="ml-auto shrink-0 text-xs text-accent-11 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="grid gap-2">
        {milestones.map((event) => (
          <div
            key={event.id}
            className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-2"
          >
            <p className="truncate text-sm font-medium">{event.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatPartialRange(event.date, event.precision, event.endDate, event.endPrecision)}
            </p>
            {event.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
