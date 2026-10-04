import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import type { AssociateGroup } from "@/server/queries/associates";

/**
 * Everyone noted as being in someone else's life, on /people/friends.
 *
 * Read-only, and a server component because of it: these entries are written
 * and corrected on a friend's page or on the associate's own, where the
 * context that makes them mean anything is. Someone in two friends' lives is
 * listed under each, and both rows open the same page.
 *
 * The notes themselves are not repeated here — only how many there are. Which
 * of them is safe to raise depends on which friend you are talking to, and a
 * list grouped by friend would show every note under every one of them.
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
                    <Link
                      href={`/people/friends/${entry.id}`}
                      className="text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {entry.name}
                    </Link>
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
                {entry.noteCount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {entry.noteCount === 1 ? "1 note" : `${entry.noteCount} notes`}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
