import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";

const TABS = [
  { key: "people", href: "/people", label: "People", icon: "Users" },
  { key: "friends", href: "/people/friends", label: "Their people", icon: "UsersRound" },
] as const;

/**
 * The two views of the people list.
 *
 * Links rather than the `Tabs` primitive used in Settings: these navigate
 * between routes, and a tablist whose panels are separate pages is a lie to a
 * screen reader. `aria-current` says which page you are on, which is the true
 * statement — and it means neither page needs to be a client component.
 *
 * The negative margin and inner scroll are lifted from the settings strip: it
 * keeps the row from pushing the page wide at 375px.
 */
export function PeopleTabs({ active }: { active: "people" | "friends" }) {
  return (
    <nav
      aria-label="People views"
      className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"
    >
      <div className="inline-flex w-max items-center gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                current
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon name={tab.icon} className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
