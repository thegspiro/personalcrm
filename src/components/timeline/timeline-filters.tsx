"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const KINDS = [
  { value: "interaction", label: "Interactions" },
  { value: "life-event", label: "Life events" },
  { value: "important-date", label: "Dates" },
  { value: "gift", label: "Gifts" },
];

/**
 * Filters for the global feed, including a date range — the way you reach back
 * into history rather than scrolling for it.
 */
export function TimelineFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const activeKinds = new Set((params.get("kinds") ?? "").split(",").filter(Boolean));

  function update(next: URLSearchParams) {
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function toggleKind(kind: string) {
    const next = new URLSearchParams(params.toString());
    const set = new Set(activeKinds);
    if (set.has(kind)) set.delete(kind);
    else set.add(kind);
    if (set.size === 0) next.delete("kinds");
    else next.set("kinds", [...set].join(","));
    update(next);
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    update(next);
  }

  const hasFilters = params.toString().length > 0;

  return (
    <div className="grid gap-2.5">
      <div className="scroll-x no-scrollbar -mx-4 flex gap-1.5 px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        <button
          type="button"
          onClick={() => update(new URLSearchParams())}
          aria-pressed={activeKinds.size === 0}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            activeKinds.size === 0
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border hover:bg-muted",
          )}
        >
          Everything
        </button>
        {KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            onClick={() => toggleKind(kind.value)}
            aria-pressed={activeKinds.has(kind.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              activeKinds.has(kind.value)
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border hover:bg-muted",
            )}
          >
            {kind.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="timeline-search">Search</Label>
          <Input
            id="timeline-search"
            defaultValue={params.get("q") ?? ""}
            placeholder="Anything you wrote"
            onBlur={(event) => setParam("q", event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") setParam("q", event.currentTarget.value.trim());
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="timeline-from">From</Label>
          <Input
            id="timeline-from"
            type="date"
            defaultValue={params.get("from") ?? ""}
            onChange={(event) => setParam("from", event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="timeline-to">To</Label>
          <Input
            id="timeline-to"
            type="date"
            defaultValue={params.get("to") ?? ""}
            onChange={(event) => setParam("to", event.target.value)}
          />
        </div>
      </div>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => update(new URLSearchParams())}
          className="justify-self-start text-xs font-medium text-accent-11 hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
