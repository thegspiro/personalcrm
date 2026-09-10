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

/**
 * What each kind looks like. Colour alone never carries the meaning: the agenda
 * spells the kind out, and every chip has its title as its text.
 *
 * The text uses the `-11` step of each colour, not the colour itself.
 * `--success` and `--warning` are chosen to be seen as a fill; as small text on
 * a tint of themselves they managed 2.77 and 2.13 against a 4.5 threshold.
 *
 * Nothing in a chip is drawn at reduced opacity, and the suffixes below must
 * not be. The `-11` steps clear 4.5:1 with nothing to spare at 11px; the `·
 * name` and `· note` spans carried `opacity-70`, which put green on its own
 * tint back at 3:1 and reintroduced exactly the failure those steps exist to
 * prevent. It held for as long as it did because the chip only renders a
 * suffix when a happening carries a contact or a note, so the violation
 * appeared only when such a chip landed on a visible day. The separator is
 * what sets the suffix apart; the colour is not.
 */
const KIND_CLASS: Record<CalendarKind, string> = {
  plan: "bg-accent-3 text-accent-11",
  date: "bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--warning-11)]",
  task: "bg-muted text-muted-foreground",
  happening: "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success-11)]",
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
  const who = entry.contact ? displayName(entry.contact) : null;
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
      title={[`${KIND_LABEL[entry.kind]}: ${entry.title}`, who].filter(Boolean).join(" — ")}
    >
      {time ? <span className="tabular-nums">{time} </span> : null}
      {entry.title}
      {/* Whose it is, in the chip rather than beside it. Every canonical
          birthday is titled "Birthday", so two on one day were two identical
          links — and in a grid square there is no room for a separate column
          to carry the name, which is why it belongs here and not in the
          layouts. The agenda used to add its own and no longer needs to. */}
      {who ? <span> · {who}</span> : null}
      {/* The state the query went to the trouble of working out. Without it a
          finished follow-up reads exactly like an outstanding one, and the
          distinction was being carried all the way here and thrown away. */}
      {entry.note ? <span> · {entry.note}</span> : null}
    </Link>
  );
}
