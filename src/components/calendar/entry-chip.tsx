import Link from "next/link";
import type { CalendarEntry, CalendarKind } from "@/server/queries/calendar";
import { formatPlanTime } from "@/lib/plan-time";
import { cn } from "@/lib/utils";

/**
 * One dated thing, wherever it appears.
 *
 * Shared by the grid and the agenda so a plan reads the same on a phone as on a
 * desktop — the two views differ in layout, not in what they say.
 */

/** What each kind looks like. Colour alone never carries the meaning: the
 * agenda spells the kind out, and every chip has its title as its text. */
const KIND_CLASS: Record<CalendarKind, string> = {
  plan: "bg-accent-3 text-accent-11",
  date: "bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--warning)]",
  task: "bg-muted text-muted-foreground",
  happening: "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]",
  interaction: "bg-secondary text-secondary-foreground",
};

export const KIND_LABEL: Record<CalendarKind, string> = {
  plan: "Plan",
  date: "Date",
  task: "Follow-up",
  happening: "Happening",
  interaction: "Logged",
};

export function displayName(contact: { firstName: string; lastName: string | null }): string {
  return contact.lastName ? `${contact.firstName} ${contact.lastName}` : contact.firstName;
}

export function EntryChip({ entry, className }: { entry: CalendarEntry; className?: string }) {
  const time = entry.minute === null ? null : formatPlanTime(entry.minute);
  return (
    <Link
      href={entry.href}
      // `min-w-0` and `truncate` together, and the grid cell above carries
      // `min-w-0` as well: without every ancestor doing so a long title widens
      // its column and pushes the last day of the week off a phone screen.
      className={cn(
        "block min-w-0 truncate rounded px-1 py-0.5 text-[11px] leading-4 hover:underline",
        KIND_CLASS[entry.kind],
        className,
      )}
      title={`${KIND_LABEL[entry.kind]}: ${entry.title}`}
    >
      {time ? <span className="tabular-nums">{time} </span> : null}
      {entry.title}
    </Link>
  );
}
