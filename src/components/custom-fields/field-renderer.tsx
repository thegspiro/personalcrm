"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import {
  fieldInputName,
  fieldOptions,
  fieldValueAsList,
  RENDERED_FIELDS_INPUT,
  type DefinitionLike,
} from "@/lib/custom-fields";

export interface RenderableField {
  definition: {
    id: string;
    label: string;
    description: string | null;
    fieldType: DefinitionLike["fieldType"];
    options: unknown;
  };
  value: unknown;
}

/**
 * The custom fields for one record, plus the hidden marker that tells the
 * server which of them were on screen.
 *
 * That marker matters: in a FormData an unchecked checkbox and a field that
 * was never rendered look identical, so without it saving from a form that
 * omits custom fields would clear every boolean on the record.
 */
export function CustomFieldInputs({
  fields,
  className,
  errors,
  formId,
}: {
  fields: RenderableField[];
  className?: string;
  errors?: Record<string, string>;
  /**
   * Distinguishes one rendering of a definition from another on the same page.
   *
   * Two forms carrying the same custom field — an add form and an edit form
   * open together, or two edit forms — would otherwise give their inputs the
   * same DOM id, and a label then points at whichever came first. Clicking it
   * moves focus into somebody else's unsaved row.
   */
  formId?: string;
}) {
  if (fields.length === 0) return null;

  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-2.5", className)}>
      <input
        type="hidden"
        name={RENDERED_FIELDS_INPUT}
        value={fields.map((field) => field.definition.id).join(",")}
      />
      {fields.map((field) => (
        <CustomFieldInput
          key={field.definition.id}
          field={field}
          formId={formId}
          error={errors?.[fieldInputName(field.definition.id)]}
        />
      ))}
    </div>
  );
}

function CustomFieldInput({
  field,
  error,
  formId,
}: {
  field: RenderableField;
  error?: string;
  formId?: string;
}) {
  const { definition, value } = field;
  const name = fieldInputName(definition.id);
  const id = formId ? `cf-${formId}-${definition.id}` : `cf-${definition.id}`;
  const options = fieldOptions(definition);

  switch (definition.fieldType) {
    case "LONGTEXT":
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <Textarea id={id} name={name} rows={3} defaultValue={asText(value)} />
        </Field>
      );

    case "NUMBER":
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <Input
            id={id}
            name={name}
            type="number"
            step="any"
            inputMode="decimal"
            defaultValue={asText(value)}
          />
        </Field>
      );

    case "DATE":
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <Input id={id} name={name} type="date" defaultValue={asText(value)} />
        </Field>
      );

    case "URL":
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <Input
            id={id}
            name={name}
            type="url"
            inputMode="url"
            placeholder="example.com"
            defaultValue={asText(value)}
          />
        </Field>
      );

    case "BOOLEAN":
      return (
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              name={name}
              value="true"
              defaultChecked={value === true}
              className="size-4 shrink-0"
            />
            <span className="min-w-0">{definition.label}</span>
          </label>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : definition.description ? (
            <p className="text-xs text-muted-foreground/80">{definition.description}</p>
          ) : null}
        </div>
      );

    case "SELECT":
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <select
            id={id}
            name={name}
            defaultValue={asText(value)}
            className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">Not set</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
      );

    case "MULTISELECT": {
      const selected = new Set(fieldValueAsList(value));
      return (
        <div className="grid gap-1.5">
          <Label>{definition.label}</Label>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <label
                key={option}
                className="inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs has-[:checked]:border-accent-8 has-[:checked]:bg-accent-3 has-[:checked]:text-accent-11"
              >
                <input
                  type="checkbox"
                  name={name}
                  value={option}
                  defaultChecked={selected.has(option)}
                  className="sr-only"
                />
                <span className="truncate">{option}</span>
              </label>
            ))}
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : definition.description ? (
            <p className="text-xs text-muted-foreground/80">{definition.description}</p>
          ) : null}
        </div>
      );
    }

    default:
      return (
        <Field label={definition.label} hint={definition.description} error={error} htmlFor={id}>
          <Input id={id} name={name} defaultValue={asText(value)} />
        </Field>
      );
  }
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Custom fields on a quick-entry form, collapsed by default.
 *
 * Logging something has to stay fast — that is the whole point of those forms
 * — so custom fields are one tap away rather than in the way, and they never
 * block submit.
 */
export function CollapsibleCustomFields({
  fields,
  formId,
}: {
  fields: RenderableField[];
  formId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  if (fields.length === 0) return null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {open ? "Fewer details" : `More details (${fields.length})`}
      </button>
      {/*
        Kept mounted and hidden rather than unmounted: collapsing the panel
        after typing must not throw the input away, and a hidden input still
        submits.
      */}
      <CustomFieldInputs
        fields={fields}
        formId={formId}
        className={open ? undefined : "hidden"}
      />
    </div>
  );
}
