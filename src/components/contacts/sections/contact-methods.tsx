"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { Icon } from "@/components/nav/icon";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { termColorClasses } from "@/lib/format";
import { methodLink } from "@/lib/contact-methods";
import {
  createContactMethod,
  deleteContactMethod,
  moveContactMethod,
  setPrimaryContactMethod,
  updateContactMethod,
} from "@/server/actions/details";

export interface ContactMethodItem {
  id: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
  /** Carried alongside the term so the edit form can preselect the chip. */
  typeId: string | null;
  type: {
    slug: string;
    label: string;
    icon: string | null;
    color: string | null;
  } | null;
}

/**
 * Shared by adding a method and correcting one, so the two cannot drift — the
 * action reads the whole form and writes what it finds, which means a field
 * present on only one of them is a field the other silently clears.
 */
function MethodFields({
  formId,
  types,
  method,
}: {
  formId: string;
  types: TermOption[];
  method?: ContactMethodItem;
}) {
  return (
    <>
      <TermChips
        name="typeId"
        label="Kind"
        terms={types}
        defaultValue={method?.typeId}
      />
      <Field label="Number, address or handle" htmlFor={`${formId}-value`}>
        <Input
          id={`${formId}-value`}
          name="value"
          required
          maxLength={255}
          defaultValue={method?.value ?? ""}
          placeholder="+1 555 010 4477"
        />
      </Field>
      <Field
        label="Label (optional)"
        htmlFor={`${formId}-label`}
        hint="For when the kind is not enough — “old number”, “only checks on weekends”."
      >
        <Input
          id={`${formId}-label`}
          name="label"
          maxLength={96}
          defaultValue={method?.label ?? ""}
          placeholder="Work"
        />
      </Field>
    </>
  );
}

function MethodRow({
  method,
  types,
  first,
  last,
  reorderable,
}: {
  method: ContactMethodItem;
  types: TermOption[];
  first: boolean;
  last: boolean;
  /**
   * False for the only method there is, and for the primary — which the list
   * pins first, so it has nowhere to move to.
   */
  reorderable: boolean;
}) {
  const run = useAction();
  const add = useAddAction();
  const link = methodLink(method.type?.slug ?? null, method.value);

  return (
    <SectionRow
      onDelete={() => void run(() => deleteContactMethod(method.id), "Removed")}
      deleteLabel={`Remove ${method.type?.label ?? "contact method"}`}
      editLabel={`Edit ${method.type?.label ?? "contact method"}`}
      editForm={(close) => (
        <form
          action={add(updateContactMethod, close, "Saved")}
          className="grid gap-2.5"
        >
          <input type="hidden" name="id" value={method.id} />
          <MethodFields
            formId={`method-${method.id}`}
            types={types}
            method={method}
          />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {method.type?.icon ? (
          <Icon
            name={method.type.icon}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        {/* A number you cannot press is a number you retype into the dialer. */}
        {link.href ? (
          <a
            href={link.href}
            className="truncate text-sm font-medium underline-offset-2 hover:underline"
          >
            {method.value}
          </a>
        ) : (
          <span className="truncate text-sm font-medium">{method.value}</span>
        )}
        {method.isPrimary ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Star className="size-2.5 fill-current" />
            Primary
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {method.type ? (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] ${termColorClasses(method.type.color)}`}
          >
            {method.type.label}
          </span>
        ) : null}
        {method.label ? (
          <span className="text-[11px] text-muted-foreground">
            {method.label}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 print:hidden">
        {method.isPrimary ? null : (
          <button
            type="button"
            onClick={() =>
              void run(() => setPrimaryContactMethod(method.id), "Made primary")
            }
            className="tap min-h-8 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Make primary
          </button>
        )}
        {reorderable ? (
          <>
            <button
              type="button"
              disabled={first}
              aria-label="Move up"
              onClick={() => void run(() => moveContactMethod(method.id, "up"))}
              className="tap flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={last}
              aria-label="Move down"
              onClick={() =>
                void run(() => moveContactMethod(method.id, "down"))
              }
              className="tap flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </SectionRow>
  );
}

export function ContactMethodsSection({
  contactId,
  methods,
  types,
}: {
  contactId: string;
  methods: ContactMethodItem[];
  types: TermOption[];
}) {
  const add = useAddAction();

  return (
    <SectionCard
      title="How to reach them"
      icon="Phone"
      count={methods.length}
      addLabel="Add a way to reach them"
      form={(close) => (
        <form
          action={add(createContactMethod, close, "Added")}
          className="grid gap-2.5"
        >
          <input type="hidden" name="contactId" value={contactId} />
          <MethodFields formId="method-new" types={types} />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {methods.length === 0 ? (
        <SectionEmpty>
          No phone number, email address or handle recorded.
        </SectionEmpty>
      ) : (
        methods.map((method, index) => (
          <MethodRow
            key={method.id}
            method={method}
            types={types}
            first={index === 0}
            last={index === methods.length - 1}
            reorderable={methods.length > 1 && !method.isPrimary}
          />
        ))
      )}
    </SectionCard>
  );
}
