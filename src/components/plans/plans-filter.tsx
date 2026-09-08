import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The two views of a plans list: still open, or finished with.
 *
 * Closing a plan out used to make it disappear with nothing anywhere to look it
 * back up — `listPlans` has always been able to fetch the closed ones, and
 * nothing ever asked it to. This is what asks.
 *
 * Two exclusive views rather than one widened list, and that is a correctness
 * point rather than a preference: statuses sort open-first and the list is
 * capped, so "open plans plus the closed ones" on a busy account is just the
 * open plans, with the history pushed off the end. Asking for the closed ones
 * by themselves is what makes them reachable.
 *
 * Links rather than a client-side toggle, for the reason `PeopleTabs` gives:
 * both pages are already `force-dynamic` server components, so the query string
 * *is* the state, and `aria-current` says which view you are on without either
 * page needing to become a client component. A `tablist` would be the wrong
 * role — these navigate.
 */
export function PlansFilter({
  basePath,
  closedOnly,
}: {
  /** The page this filter sits on, e.g. `/ideas`. */
  basePath: string;
  closedOnly: boolean;
}) {
  const views = [
    { href: basePath, label: "Open", current: !closedOnly },
    { href: `${basePath}?done=1`, label: "Done", current: closedOnly },
  ];

  return (
    <nav aria-label="Plans views" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <div className="inline-flex w-max items-center gap-1 rounded-lg bg-muted p-1">
        {views.map((view) => (
          <Link
            key={view.href}
            href={view.href}
            aria-current={view.current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view.current
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
