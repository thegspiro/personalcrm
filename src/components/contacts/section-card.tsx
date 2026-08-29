"use client";

import * as React from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
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
    <section className="min-w-0 rounded-xl border border-border bg-card">
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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 px-4 pb-4">
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

/**
 * A row in a section, with edit and delete affordances.
 *
 * `editForm` swaps the row's contents for the form in place rather than
 * opening a dialog. The same reason adding is inline: a nested modal on a
 * phone is a dead end, and an edit form that covers the row hides the thing
 * you are trying to correct.
 *
 * Unlike the delete ×, the pencil is visible without hovering — a phone has no
 * hover, and an affordance that only appears on a pointer is not an
 * affordance on the device this app is designed around.
 */
export function SectionRow({
  children,
  onDelete,
  deleteLabel = "Delete",
  deleteConfirm,
  editForm,
  editLabel = "Edit",
  className,
  id,
}: {
  children: React.ReactNode;
  onDelete?: () => void;
  deleteLabel?: string;
  deleteConfirm?: string;
  /**
   * Receives a `close` callback, so a saved edit collapses the form back to
   * the row it corrected.
   */
  editForm?: (close: () => void) => React.ReactNode;
  editLabel?: string;
  className?: string;
  id?: string;
}) {
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!id || window.location.hash !== `#${id}`) return;

    // Fragment navigation scrolls a generic div into view, but does not move
    // keyboard focus to it. Moving focus as well makes the destination clear
    // to screen-reader and keyboard users after following a timeline card.
    document.getElementById(id)?.focus({ preventScroll: true });
  }, [id]);

  if (editing && editForm) {
    return (
      <div id={id} tabIndex={-1} className={cn("rounded-lg border border-accent-8 bg-card p-3", className)}>
        {editForm(() => setEditing(false))}
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      id={id}
      tabIndex={-1}
      className={cn(
        "group flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2 target:border-accent-9 target:ring-2 target:ring-accent-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {editForm || onDelete ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {editForm ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={editLabel}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                if (!deleteConfirm || window.confirm(deleteConfirm)) onDelete();
              }}
              aria-label={deleteLabel}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-xs text-muted-foreground">{children}</p>;
}
