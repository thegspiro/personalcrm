"use client";

import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";

/**
 * A collapsible section on the contact page with an inline add form.
 *
 * Adding stays on the page rather than opening a modal — the plan calls for
 * inline editing everywhere, and on a phone a nested modal is a dead end.
 */
export function SectionCard({
  title,
  icon,
  count,
  addLabel,
  form,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  count?: number;
  addLabel?: string;
  /**
   * Receives a `close` callback so the panel collapses once something has
   * actually been added — leaving it open with the text still in it makes the
   * next click look like it does nothing.
   */
  form?: (close: () => void) => React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [adding, setAdding] = React.useState(false);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{title}</span>
          {count !== undefined && count > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {count}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>

        {form ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={addLabel ?? `Add to ${title}`}
            onClick={() => {
              setAdding((v) => !v);
              setOpen(true);
            }}
          >
            <Plus className={cn("transition-transform", adding && "rotate-45")} />
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-2.5 px-4 pb-4">
          {adding && form ? (
            <div className="rounded-lg border border-dashed border-border p-3">
              {form(() => setAdding(false))}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Row wrapper with a hover-revealed delete affordance. */
export function SectionRow({
  children,
  onDelete,
  deleteLabel = "Delete",
  className,
}: {
  children: React.ReactNode;
  onDelete?: () => void;
  deleteLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </div>
  );
}

export function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-xs text-muted-foreground">{children}</p>;
}
