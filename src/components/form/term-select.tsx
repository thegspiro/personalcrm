"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Label } from "@/components/ui/label";
import { termColorClasses } from "@/lib/format";

export interface TermOption {
  id: string;
  label: string;
  icon: string | null;
  color: string | null;
}

/**
 * Picks a taxonomy term. Renders as a chip row rather than a dropdown — the
 * lists are short, and one tap beats open-scroll-tap on a phone.
 */
export function TermChips({
  name,
  label,
  terms,
  defaultValue,
  allowEmpty = true,
  emptyLabel = "None",
  className,
  onSelect,
}: {
  name: string;
  label?: string;
  terms: TermOption[];
  defaultValue?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  onSelect?: (id: string) => void;
}) {
  const [selected, setSelected] = React.useState<string>(defaultValue ?? "");

  function choose(id: string) {
    setSelected(id);
    onSelect?.(id);
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label>{label}</Label> : null}
      <input type="hidden" name={name} value={selected} />
      <div className="flex flex-wrap gap-1.5">
        {allowEmpty ? (
          <Chip active={selected === ""} onClick={() => choose("")}>
            {emptyLabel}
          </Chip>
        ) : null}
        {terms.map((term) => (
          <Chip
            key={term.id}
            active={selected === term.id}
            color={term.color}
            onClick={() => choose(term.id)}
          >
            {term.icon ? <Icon name={term.icon} className="size-3.5" /> : null}
            {term.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string | null;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : cn("border-border hover:bg-muted", color ? termColorClasses(color) : ""),
      )}
    >
      {children}
    </button>
  );
}

/** Plain select, for long lists where chips would overwhelm the form. */
export function TermSelect({
  name,
  id,
  label,
  terms,
  defaultValue,
  placeholder = "None",
  className,
}: {
  name: string;
  /**
   * Defaults to `name`. Set it when an add form and an inline edit form are on
   * the page at once: two elements sharing an id makes the label point at
   * whichever the browser finds first, which is not the one you tapped.
   */
  id?: string;
  label?: string;
  terms: TermOption[];
  defaultValue?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const elementId = id ?? name;
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label htmlFor={elementId}>{label}</Label> : null}
      <select
        id={elementId}
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{placeholder}</option>
        {terms.map((term) => (
          <option key={term.id} value={term.id}>
            {term.label}
          </option>
        ))}
      </select>
    </div>
  );
}
