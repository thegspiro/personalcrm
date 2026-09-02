"use client";

import * as React from "react";
import type { TaxonomyKind } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { termColorClasses } from "@/lib/format";
import {
  createTerm,
  deleteTerm,
  moveTerm,
  restoreMissingDefaults,
  setTermActive,
  updateTerm,
} from "@/server/actions/taxonomy";

export interface AdminTermView {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  isActive: boolean;
  usageCount: number;
  inverseTermId: string | null;
  inverseLabel: string | null;
}

export interface TaxonomyGroupView {
  kind: TaxonomyKind;
  title: string;
  description: string;
  terms: AdminTermView[];
}

/** The palette the app's colour classes actually support. */
const COLORS = [
  "slate",
  "red",
  "rose",
  "pink",
  "fuchsia",
  "violet",
  "indigo",
  "blue",
  "sky",
  "cyan",
  "teal",
  "emerald",
  "green",
  "lime",
  "yellow",
  "amber",
  "orange",
];

export function TaxonomySettings({ groups }: { groups: TaxonomyGroupView[] }) {
  const run = useAction();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Every &ldquo;type&rdquo; in the app is one of these — rename them, recolour them, or add
          your own.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void run(() => restoreMissingDefaults(), "Defaults restored")}
        >
          Restore missing defaults
        </Button>
      </div>

      {groups.map((group) => (
        <TaxonomyGroupCard key={group.kind} group={group} />
      ))}
    </div>
  );
}

function TaxonomyGroupCard({ group }: { group: TaxonomyGroupView }) {
  const add = useAddAction();
  const active = group.terms.filter((term) => term.isActive);

  return (
    <SectionCard
      title={group.title}
      icon="Tags"
      count={active.length}
      addLabel={`Add to ${group.title.toLowerCase()}`}
      defaultOpen={false}
      form={(close) => (
        <form action={add(createTerm, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="kind" value={group.kind} />
          <Field label="Name" htmlFor={`new-${group.kind}`}>
            <Input id={`new-${group.kind}`} name="label" required />
          </Field>
          <ColorPicker name="color" />
          {group.kind === "RELATIONSHIP_TYPE" ? (
            <Field
              label="The other way round"
              htmlFor={`inv-${group.kind}`}
              hint="If A is B's mentor, B is A's… Leave as itself for symmetric ones like 'cousin'."
            >
              <select
                id={`inv-${group.kind}`}
                name="inverseTermId"
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value="">Itself</option>
                {group.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      <p className="px-1 text-[11px] text-muted-foreground">{group.description}</p>
      {group.terms.length === 0 ? (
        <SectionEmpty>Nothing here yet.</SectionEmpty>
      ) : (
        group.terms.map((term) => <TermRow key={term.id} term={term} group={group} />)
      )}
    </SectionCard>
  );
}

function TermRow({ term, group }: { term: AdminTermView; group: TaxonomyGroupView }) {
  const run = useAction();
  const edit = useEditAction();
  const [editing, setEditing] = React.useState(false);

  return (
    <SectionRow>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-xs",
              termColorClasses(term.color),
              !term.isActive && "opacity-50",
            )}
          >
            {term.icon ? <Icon name={term.icon} className="size-3 shrink-0" /> : null}
            <span className="truncate">{term.label}</span>
          </span>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {term.isActive ? "" : "Off · "}
            {term.usageCount > 0 ? `used ${term.usageCount}×` : "unused"}
            {term.inverseLabel && term.inverseTermId !== term.id
              ? ` · inverse: ${term.inverseLabel}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Move ${term.label} up`}
            onClick={() => void run(() => moveTerm(term.id, "up"))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="ChevronUp" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${term.label} down`}
            onClick={() => void run(() => moveTerm(term.id, "down"))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="ChevronDown" className="size-4" />
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={editing ? `Stop editing ${term.label}` : `Edit ${term.label}`}
          >
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <form
          action={edit(updateTerm, () => setEditing(false), "Saved")}
          className="mt-2.5 grid gap-2.5 border-t border-border/70 pt-2.5"
        >
          <input type="hidden" name="id" value={term.id} />
          <Field label="Name" htmlFor={`label-${term.id}`}>
            <Input id={`label-${term.id}`} name="label" required defaultValue={term.label} />
          </Field>
          <ColorPicker name="color" defaultValue={term.color} />
          <Field label="Icon (optional)" htmlFor={`icon-${term.id}`} hint="A Lucide icon name.">
            <Input id={`icon-${term.id}`} name="icon" defaultValue={term.icon ?? ""} />
          </Field>
          {group.kind === "RELATIONSHIP_TYPE" ? (
            <Field
              label="The other way round"
              htmlFor={`inverse-${term.id}`}
              hint="Both terms are updated, so links stay typed correctly in both directions."
            >
              <select
                id={`inverse-${term.id}`}
                name="inverseTermId"
                defaultValue={term.inverseTermId ?? term.id}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value={term.id}>Itself</option>
                {group.terms
                  .filter((other) => other.id !== term.id)
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.label}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm">Save</SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void run(
                  () => setTermActive(term.id, !term.isActive),
                  term.isActive ? "Turned off" : "Turned back on",
                )
              }
            >
              {term.isActive ? "Turn off" : "Turn back on"}
            </Button>
            {term.usageCount === 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (!confirm(`Delete "${term.label}"?`)) return;
                  void run(() => deleteTerm(term.id), "Deleted");
                }}
              >
                Delete
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                In use — turn it off instead of deleting, and the records keep it.
              </span>
            )}
          </div>
        </form>
      ) : null}
    </SectionRow>
  );
}

function ColorPicker({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [value, setValue] = React.useState(defaultValue ?? "");

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Colour</span>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setValue("")}
          aria-pressed={value === ""}
          aria-label="No colour"
          className={cn(
            "size-7 rounded-full border border-border text-[10px] text-muted-foreground",
            value === "" && "ring-2 ring-accent-8 ring-offset-1 ring-offset-card",
          )}
        >
          —
        </button>
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setValue(color)}
            aria-pressed={value === color}
            aria-label={color}
            className={cn(
              "size-7 rounded-full border border-border",
              termColorClasses(color),
              value === color && "ring-2 ring-accent-8 ring-offset-1 ring-offset-card",
            )}
          />
        ))}
      </div>
    </div>
  );
}
