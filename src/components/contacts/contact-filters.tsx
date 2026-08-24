"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const SORTS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "overdue", label: "Overdue" },
  { value: "added", label: "Newest" },
];

export function ContactFilters({
  categories,
}: {
  categories: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = React.useState(params.get("q") ?? "");

  // Debounced so typing doesn't fire a navigation per keystroke.
  React.useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => update("q", search || null), 250);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const activeCategory = params.get("category") ?? "";
  const activeSort = params.get("sort") ?? "name";
  const showArchived = params.get("scope") === "archived";

  return (
    <div className="grid gap-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, job, city, or anything you noted…"
          className="pl-9 pr-9"
          aria-label="Search people"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="scroll-x no-scrollbar -mx-4 flex gap-1.5 px-4 pb-0.5 lg:mx-0 lg:flex-wrap lg:px-0">
        <FilterChip active={activeCategory === ""} onClick={() => update("category", null)}>
          Everyone
        </FilterChip>
        {categories.map((category) => (
          <FilterChip
            key={category.id}
            active={activeCategory === category.id}
            onClick={() => update("category", activeCategory === category.id ? null : category.id)}
          >
            {category.label}
          </FilterChip>
        ))}
        <FilterChip
          active={showArchived}
          onClick={() => update("scope", showArchived ? null : "archived")}
        >
          Archived
        </FilterChip>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0">Sort</span>
        {SORTS.map((sort) => (
          <button
            key={sort.value}
            type="button"
            onClick={() => update("sort", sort.value === "name" ? null : sort.value)}
            className={cn(
              "rounded-full px-2 py-1 font-medium transition-colors",
              activeSort === sort.value ? "bg-accent-3 text-accent-11" : "hover:bg-muted",
            )}
          >
            {sort.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
