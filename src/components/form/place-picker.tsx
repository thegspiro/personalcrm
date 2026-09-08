"use client";

import * as React from "react";
import { Check, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import type { PlaceSuggestion } from "@/server/queries/locations";

export type { PlaceSuggestion };

/**
 * Offers the places you have already been, to fill a "Where" box.
 *
 * A filler, not a field. It writes the chosen place's name into the box beside
 * it and posts nothing of its own — no hidden input, no id. That is deliberate
 * and load-bearing:
 *
 * `resolveLocation` is a get-or-create on `@@unique([ownerId, normalizedName])`,
 * so picking a place and typing its name are already the same write, and the
 * name identifies the row on its own. Posting an id would buy no precision and
 * would hand a forged form something to smuggle in — the rule quick-add states
 * where it resolves a place from confirmed text rather than a posted id.
 *
 * Note what this component does *not* carry: a `role="group"` with an
 * `aria-label`. `getByLabel` matches an `aria-label` on any element, so a
 * labelled wrapper sitting beside an input labelled "Where" makes both match
 * and turns every existing locator into a strict-mode violation. The picker
 * lives inside the field's own `<Field>` and stays anonymous; only its search
 * box is named, and "Search places" is a string nothing else uses.
 */
export function PlacePicker({
  places,
  truncated = false,
  value,
  onPick,
  summary = "Pick from your places",
  className,
}: {
  places: PlaceSuggestion[];
  /** True when the feed hit its cap, so the list can say so. */
  truncated?: boolean;
  /** The current text of the box this fills, so the matching row reads as chosen. */
  value?: string;
  onPick: (place: PlaceSuggestion) => void;
  /** The disclosure's label, for a form where "places" needs narrowing. */
  summary?: string;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const rootRef = React.useRef<HTMLDetailsElement>(null);

  // Collapse and clear alongside the form's own reset, the way ContactPicker
  // restores its defaults: a sheet reopened after a save should not still be
  // showing the search from last time.
  React.useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const restore = () => {
      setQuery("");
      if (rootRef.current) rootRef.current.open = false;
    };
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, []);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? places.filter(
          (place) =>
            place.name.toLowerCase().includes(q) ||
            (place.address?.toLowerCase().includes(q) ?? false) ||
            (place.city?.toLowerCase().includes(q) ?? false),
        )
      : places;
    return pool.slice(0, q ? 30 : 12);
  }, [places, query]);

  if (places.length === 0) return null;

  const chosen = value?.trim().toLowerCase();

  return (
    // Closed by default. A plans list draws one of these per row, and thirty
    // open lists is thirty scrolling panels between you and the form.
    <details ref={rootRef} className={cn("group", className)}>
      <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <MapPin className="size-3.5" aria-hidden />
        {summary}
      </summary>

      <div className="mt-1.5 grid gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places…"
            className="pl-9"
            aria-label="Search places"
          />
        </div>

        <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No place matches. Type the name to add a new one.
            </p>
          ) : (
            <ul>
              {matches.map((place) => {
                const active = chosen !== undefined && place.name.toLowerCase() === chosen;
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => onPick(place)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        active && "bg-accent-3/60",
                      )}
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate">{place.name}</span>
                        {place.subtitle ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {place.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {active ? <Check className="size-4 shrink-0 text-accent-11" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {truncated ? (
          <ListCapNotice
            shown={places.length}
            noun="places"
            hint="Search to narrow it, or just type the name."
          />
        ) : null}
      </div>
    </details>
  );
}
