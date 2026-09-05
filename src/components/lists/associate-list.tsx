import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import type { AssociateGroup } from "@/server/queries/associates";

/**
 * Everyone noted as being in someone else's life, on /people/friends.
 *
 * Read-only, and a server component because of it: these entries are written
 * and corrected on the person's own page, where the context that makes them
 * mean anything is. A second editing surface would be the same wiring twice
 * and two places for the shared-fields trap to bite.
 */
export function AssociateList({ groups }: { groups: AssociateGroup[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {groups.map((group) => (
        <section key={group.contact.id} className="grid gap-1.5">
          <h3 className="text-sm font-semibold tracking-tight">
            <Link
              href={`/people/${group.contact.id}`}
              className="underline-offset-2 hover:underline"
            >
              {group.contact.name}
            </Link>
          </h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {group.entries.map((entry) => (
              <li
                key={entry.id}
                className="min-w-0 rounded-lg border border-border bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {entry.promoted ? (
                    <Link
                      href={`/people/${entry.promoted.id}`}
                      className="text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {entry.promoted.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{entry.name}</span>
                  )}
                  {entry.isPromoted ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      <Icon name="UserCheck" className="size-3" />
                      Now tracked
                    </span>
                  ) : null}
                  {entry.isPrivate ? (
                    <span className="inline-flex items-center rounded-full bg-accent-3 px-1.5 py-0.5 text-[11px] text-accent-11">
                      Private
                    </span>
                  ) : null}
                </div>
                {entry.howTheyKnow ? (
                  <p className="text-xs text-muted-foreground">{entry.howTheyKnow}</p>
                ) : null}
                {entry.notes ? (
                  <p className="mt-1 whitespace-pre-line text-sm">{entry.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
