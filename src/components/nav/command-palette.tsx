"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { PRIMARY_NAV, SECONDARY_NAV, visibleNav, type NavItem } from "./nav-items";
import { searchPalette } from "@/server/actions/quick-add";

interface Row {
  key: string;
  label: string;
  subtitle?: string | null;
  icon: string;
  group: "People" | "Do" | "Go";
  run: () => void;
}

/**
 * Jump anywhere, or start anything, from the keyboard.
 *
 * People are searched on the server rather than shipped to the client, which
 * is what keeps a private contact out of results while the lock is on — the
 * query goes through the same privacy filter as every other read instead of a
 * second code path that could drift.
 */
export function CommandPalette({ hideDating }: { hideDating: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<
    Array<{ id: string; name: string; subtitle: string | null }>
  >([]);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced so typing does not fire a query per keystroke.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchPalette(query);
      if (!cancelled && result.ok && result.data) setPeople(result.data.people);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const rows = React.useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();

    const peopleRows: Row[] = people.map((person) => ({
      key: `person-${person.id}`,
      label: person.name,
      subtitle: person.subtitle,
      icon: "UserRound",
      group: "People",
      run: () => go(`/people/${person.id}`),
    }));

    const actions: Row[] = [
      { key: "act-log", label: "Log an interaction", icon: "Plus", href: "/?log=1" },
      { key: "act-person", label: "Add someone", icon: "UserPlus", href: "/people/new" },
      { key: "act-household", label: "New household", icon: "Home", href: "/family" },
    ]
      .filter((action) => !q || action.label.toLowerCase().includes(q))
      .map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        group: "Do" as const,
        run: () => go(action.href),
      }));

    const routes: NavItem[] = [
      ...visibleNav(PRIMARY_NAV, hideDating),
      ...visibleNav(SECONDARY_NAV, hideDating),
    ].filter((item) => item.href !== "/more");

    const routeRows: Row[] = routes
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .map((item) => ({
        key: `route-${item.href}`,
        label: item.label,
        icon: item.icon,
        group: "Go" as const,
        run: () => go(item.href),
      }));

    return [...peopleRows, ...actions, ...routeRows];
  }, [people, query, hideDating, go]);

  React.useEffect(() => {
    setActive((current) => (current >= rows.length ? 0 : current));
  }, [rows.length]);

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (rows.length === 0 ? 0 : (current + 1) % rows.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      rows[active]?.run();
    }
  }

  let lastGroup: Row["group"] | null = null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[10%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0">
          <VisuallyHidden>
            <DialogTitle>Search and commands</DialogTitle>
          </VisuallyHidden>

          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search people, jump anywhere…"
              aria-label="Search people and commands"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
            {rows.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing matches.
              </li>
            ) : (
              rows.map((row, index) => {
                const showGroup = row.group !== lastGroup;
                lastGroup = row.group;
                return (
                  <React.Fragment key={row.key}>
                    {showGroup ? (
                      <li className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {row.group}
                      </li>
                    ) : null}
                    <li>
                      <button
                        type="button"
                        onClick={row.run}
                        onMouseEnter={() => setActive(index)}
                        className={cn(
                          "flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
                          index === active ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <Icon name={row.icon} className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{row.label}</span>
                        {row.subtitle ? (
                          <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                            {row.subtitle}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  </React.Fragment>
                );
              })
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
