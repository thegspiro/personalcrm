"use client";

import * as React from "react";
import { Check, Search, X } from "lucide-react";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PickerContact {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname?: string | null;
}

/**
 * Picks one or more people.
 *
 * The list arrives already sorted most-recently-contacted first, so the person
 * you are logging about is usually visible before you type anything.
 */
export function ContactPicker({
  name,
  label,
  contacts,
  defaultSelected = [],
  multiple = true,
  required,
  className,
  excludeIds,
  onSelectionChange,
}: {
  name: string;
  label?: string;
  contacts: PickerContact[];
  defaultSelected?: string[];
  multiple?: boolean;
  required?: boolean;
  className?: string;
  /**
   * People this picker must not offer, and must drop if they are already
   * chosen. Distinct from filtering `contacts` before passing them in: a
   * selection made *before* the exclusion applies survives that filtering,
   * because the chip disappears with the contact while the hidden input keeps
   * submitting the id. The form then looks empty and fails on submit.
   */
  excludeIds?: string[];
  /**
   * Told about the current selection whenever it changes, including the reset
   * back to the defaults. For a form where one picker narrows another — "who
   * is this person's relative" cannot offer that same person — the selection
   * has to be readable outside the picker.
   */
  onSelectionChange?: (ids: string[]) => void;
}) {
  const defaultsKey = [...new Set(defaultSelected)].join("\0");
  const intendedDefaults = React.useMemo(
    () => (defaultsKey ? defaultsKey.split("\0") : []),
    [defaultsKey],
  );
  const [selected, setSelected] = React.useState<string[]>(intendedDefaults);
  const [query, setQuery] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const restoreDefaults = () => {
      setSelected(intendedDefaults);
      setQuery("");
    };
    form.addEventListener("reset", restoreDefaults);
    return () => form.removeEventListener("reset", restoreDefaults);
  }, [intendedDefaults]);

  const excludedKey = [...new Set(excludeIds ?? [])].sort().join("\0");
  const excluded = React.useMemo(
    () => new Set(excludedKey ? excludedKey.split("\0") : []),
    [excludedKey],
  );

  // Derived rather than pruned in an effect: an exclusion that arrives after a
  // selection must never reach the hidden inputs, and state corrected after
  // the render that used it is a render too late. `toggle` drops it from the
  // stored list on the next interaction, so nothing accumulates.
  const live = React.useMemo(
    () => selected.filter((id) => !excluded.has(id)),
    [selected, excluded],
  );

  const offered = React.useMemo(
    () => contacts.filter((contact) => !excluded.has(contact.id)),
    [contacts, excluded],
  );

  // Held in a ref so a caller passing a fresh inline closure on every render
  // does not re-fire the callback on every render along with it. The ref is
  // updated in an effect rather than during render, which is both the rule and
  // the reason for it: a render can be thrown away and restarted, and a write
  // that happened during one of those is a write nothing asked for.
  const notify = React.useRef(onSelectionChange);
  React.useEffect(() => {
    notify.current = onSelectionChange;
  });
  React.useEffect(() => {
    notify.current?.(live);
  }, [live]);

  const byId = React.useMemo(
    () => new Map(offered.map((contact) => [contact.id, contact])),
    [offered],
  );

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? offered.filter((contact) => displayName(contact).toLowerCase().includes(q))
      : offered;
    return pool.slice(0, q ? 30 : 12);
  }, [offered, query]);

  function toggle(id: string) {
    setSelected((current) => {
      // Read through the same exclusion the render used, so a stale id cannot
      // make the next click read as a deselection of something not on screen.
      const kept = current.filter((x) => !excluded.has(x));
      if (!multiple) return kept.includes(id) ? [] : [id];
      return kept.includes(id) ? kept.filter((x) => x !== id) : [...kept, id];
    });
  }

  return (
    // A form can hold more than one picker -- logging an interaction has both
    // attendees and mentions -- and the two are otherwise indistinguishable to
    // assistive technology and to any locator, since the same people appear in
    // each list. Naming the group ties each one to its visible label.
    <div
      ref={rootRef}
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn("grid gap-1.5", className)}
    >
      {label ? <Label>{label}</Label> : null}
      {live.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {required && live.length === 0 ? (
        <input tabIndex={-1} aria-hidden required className="sr-only h-0 w-0" onChange={() => {}} value="" />
      ) : null}

      {live.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {live.map((id) => {
            const contact = byId.get(id);
            if (!contact) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-accent-3 px-2.5 py-1 text-xs font-medium text-accent-11"
              >
                {displayName(contact)}
                <X className="size-3" />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people…"
          className="pl-9"
          aria-label="Search people"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No one matches.</p>
        ) : (
          <ul>
            {matches.map((contact) => {
              const active = live.includes(contact.id);
              return (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => toggle(contact.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      active && "bg-accent-3/60",
                    )}
                  >
                    <Avatar className="size-7">
                      <AvatarFallback>
                        {initialsOf(contact.firstName, contact.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{displayName(contact)}</span>
                    {active ? <Check className="size-4 text-accent-11" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
