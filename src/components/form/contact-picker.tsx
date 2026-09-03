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
    notify.current?.(selected);
  }, [selected]);

  const byId = React.useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? contacts.filter((contact) => displayName(contact).toLowerCase().includes(q))
      : contacts;
    return pool.slice(0, q ? 30 : 12);
  }, [contacts, query]);

  function toggle(id: string) {
    setSelected((current) => {
      if (!multiple) return current.includes(id) ? [] : [id];
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
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
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {required && selected.length === 0 ? (
        <input tabIndex={-1} aria-hidden required className="sr-only h-0 w-0" onChange={() => {}} value="" />
      ) : null}

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
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
              const active = selected.includes(contact.id);
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
