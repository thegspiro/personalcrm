"use client";

import * as React from "react";
import type { CustomFieldEntity, CustomFieldType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { fieldOptions } from "@/lib/custom-fields";
import type { TermOption } from "@/components/form/term-select";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  moveFieldDefinition,
  setFieldActive,
  updateFieldDefinition,
} from "@/server/actions/custom-fields";

export interface AdminFieldDefinition {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  description: string | null;
  fieldType: CustomFieldType;
  options: unknown;
  appliesToCategoryIds: unknown;
  isActive: boolean;
  valueCount: number;
}

const ENTITY_LABELS: Record<CustomFieldEntity, { title: string; description: string }> = {
  CONTACT: { title: "People", description: "Shown on a person's page and edit form." },
  ROMANTIC: { title: "Dating profiles", description: "Shown on someone you're dating." },
  INTERACTION: {
    title: "Interactions",
    description: "Shown when logging — collapsed, so logging stays fast.",
  },
  DATE_ENTRY: { title: "Dates", description: "Shown when logging a date." },
};

const ENTITY_ORDER: CustomFieldEntity[] = ["CONTACT", "ROMANTIC", "INTERACTION", "DATE_ENTRY"];

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Short text",
  LONGTEXT: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  BOOLEAN: "Yes / no",
  SELECT: "One of a list",
  MULTISELECT: "Several of a list",
  URL: "Web address",
};

const OPTION_TYPES: CustomFieldType[] = ["SELECT", "MULTISELECT"];

export function CustomFieldsSettings({
  definitions,
  categories,
}: {
  definitions: Record<CustomFieldEntity, AdminFieldDefinition[]>;
  categories: TermOption[];
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-xs text-muted-foreground">
        Fields you define yourself. The app ships with what most people need; this is for the
        things only you track.
      </p>
      {ENTITY_ORDER.map((entity) => (
        <EntityFields
          key={entity}
          entity={entity}
          definitions={definitions[entity] ?? []}
          categories={categories}
        />
      ))}
    </div>
  );
}

function EntityFields({
  entity,
  definitions,
  categories,
}: {
  entity: CustomFieldEntity;
  definitions: AdminFieldDefinition[];
  categories: TermOption[];
}) {
  const add = useAddAction();
  const [fieldType, setFieldType] = React.useState<CustomFieldType>("TEXT");
  const meta = ENTITY_LABELS[entity];

  return (
    <SectionCard
      title={meta.title}
      icon="SlidersHorizontal"
      count={definitions.length}
      addLabel={`Add a field for ${meta.title.toLowerCase()}`}
      defaultOpen={definitions.length > 0}
      form={(close) => (
        <form action={add(createFieldDefinition, close, "Field added")} className="grid gap-2.5">
          <input type="hidden" name="entity" value={entity} />
          <Field label="Name" htmlFor={`label-${entity}`}>
            <Input id={`label-${entity}`} name="label" required placeholder="Coffee order" />
          </Field>
          <Field label="Type" htmlFor={`type-${entity}`}>
            <select
              id={`type-${entity}`}
              name="fieldType"
              value={fieldType}
              onChange={(event) => setFieldType(event.target.value as CustomFieldType)}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          {OPTION_TYPES.includes(fieldType) ? (
            <Field label="Choices" htmlFor={`options-${entity}`} hint="One per line.">
              <Textarea
                id={`options-${entity}`}
                name="options"
                rows={3}
                placeholder={"Flat white\nCortado\nTea"}
              />
            </Field>
          ) : null}
          <Field label="Hint (optional)" htmlFor={`desc-${entity}`}>
            <Input id={`desc-${entity}`} name="description" />
          </Field>
          {entity === "CONTACT" && categories.length > 0 ? (
            <Field
              label="Only for these categories (optional)"
              hint="Leave all unticked to show it for everyone."
            >
              <div className="flex flex-wrap gap-1.5">
                {categories.map((category) => (
                  <label
                    key={category.id}
                    className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs has-[:checked]:border-accent-8 has-[:checked]:bg-accent-3 has-[:checked]:text-accent-11"
                  >
                    <input
                      type="checkbox"
                      name="appliesToCategoryIds"
                      value={category.id}
                      className="sr-only"
                    />
                    <span className="truncate">{category.label}</span>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <SubmitButton size="sm">Add field</SubmitButton>
        </form>
      )}
    >
      <p className="px-1 text-[11px] text-muted-foreground">{meta.description}</p>
      {definitions.length === 0 ? (
        <SectionEmpty>No fields of your own here yet.</SectionEmpty>
      ) : (
        definitions.map((definition) => (
          <FieldRow key={definition.id} definition={definition} categories={categories} />
        ))
      )}
    </SectionCard>
  );
}

function FieldRow({
  definition,
  categories,
}: {
  definition: AdminFieldDefinition;
  categories: TermOption[];
}) {
  const run = useAction();
  const edit = useEditAction();
  const [editing, setEditing] = React.useState(false);
  const scoped = Array.isArray(definition.appliesToCategoryIds)
    ? (definition.appliesToCategoryIds as string[])
    : [];

  return (
    <SectionRow>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              !definition.isActive && "text-muted-foreground line-through",
            )}
          >
            {definition.label}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {TYPE_LABELS[definition.fieldType]}
            {definition.valueCount > 0 ? ` · filled in ${definition.valueCount}×` : ""}
            {scoped.length > 0 ? ` · ${scoped.length} categories` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction
            label={`Move ${definition.label} up`}
            icon="ChevronUp"
            onClick={() => void run(() => moveFieldDefinition(definition.id, "up"))}
          />
          <IconAction
            label={`Move ${definition.label} down`}
            icon="ChevronDown"
            onClick={() => void run(() => moveFieldDefinition(definition.id, "down"))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={editing ? `Stop editing ${definition.label}` : `Edit ${definition.label}`}
          >
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <form
          action={edit(updateFieldDefinition, () => setEditing(false), "Saved")}
          className="mt-2.5 grid gap-2.5 border-t border-border/70 pt-2.5"
        >
          <input type="hidden" name="id" value={definition.id} />
          <Field label="Name" htmlFor={`edit-label-${definition.id}`}>
            <Input
              id={`edit-label-${definition.id}`}
              name="label"
              required
              defaultValue={definition.label}
            />
          </Field>
          {OPTION_TYPES.includes(definition.fieldType) ? (
            <Field
              label="Choices"
              htmlFor={`edit-options-${definition.id}`}
              hint="One per line. Removing a choice leaves it on records that already use it."
            >
              <Textarea
                id={`edit-options-${definition.id}`}
                name="options"
                rows={3}
                defaultValue={fieldOptions(definition).join("\n")}
              />
            </Field>
          ) : null}
          <Field label="Hint (optional)" htmlFor={`edit-desc-${definition.id}`}>
            <Input
              id={`edit-desc-${definition.id}`}
              name="description"
              defaultValue={definition.description ?? ""}
            />
          </Field>
          {definition.entity === "CONTACT" && categories.length > 0 ? (
            <Field label="Only for these categories" hint="Untick everything to show it for all.">
              <div className="flex flex-wrap gap-1.5">
                {categories.map((category) => (
                  <label
                    key={category.id}
                    className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs has-[:checked]:border-accent-8 has-[:checked]:bg-accent-3 has-[:checked]:text-accent-11"
                  >
                    <input
                      type="checkbox"
                      name="appliesToCategoryIds"
                      value={category.id}
                      defaultChecked={scoped.includes(category.id)}
                      className="sr-only"
                    />
                    <span className="truncate">{category.label}</span>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            The type can&apos;t change after a field is created — every value stored in it is that
            shape. Make a new field instead.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm">Save</SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void run(
                  () => setFieldActive(definition.id, !definition.isActive),
                  definition.isActive ? "Turned off" : "Turned back on",
                )
              }
            >
              {definition.isActive ? "Turn off" : "Turn back on"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                const warning =
                  definition.valueCount > 0
                    ? `Delete "${definition.label}" and the ${definition.valueCount} value${definition.valueCount === 1 ? "" : "s"} recorded in it? This can't be undone — turning it off keeps them.`
                    : `Delete "${definition.label}"?`;
                if (!confirm(warning)) return;
                void run(() => deleteFieldDefinition(definition.id), "Deleted");
              }}
            >
              Delete
            </Button>
          </div>
        </form>
      ) : null}
    </SectionRow>
  );
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}
