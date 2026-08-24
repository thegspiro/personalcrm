"use client";

import Link from "next/link";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import {
  fieldValueAsDate,
  fieldValueAsList,
  isEmptyFieldValue,
} from "@/lib/custom-fields";
import { formatPartialDate } from "@/lib/date-precision";
import type { RenderableField } from "./field-renderer";

/**
 * Your own fields on a record, read-only.
 *
 * Editing happens on the edit form rather than inline, because a custom field
 * has no fixed shape and an inline editor for eight types is a lot of surface
 * for something you change rarely.
 */
export function CustomFieldValues({
  fields,
  editHref,
}: {
  fields: RenderableField[];
  editHref?: string;
}) {
  if (fields.length === 0) return null;

  const filled = fields.filter((field) => !isEmptyFieldValue(field.value));

  return (
    <SectionCard
      title="Your own fields"
      icon="SlidersHorizontal"
      count={filled.length}
      defaultOpen={filled.length > 0}
    >
      {filled.length === 0 ? (
        <SectionEmpty>
          Nothing filled in yet.{" "}
          {editHref ? (
            <Link href={editHref} className="underline">
              Edit to add
            </Link>
          ) : null}
        </SectionEmpty>
      ) : (
        filled.map((field) => (
          <SectionRow key={field.definition.id}>
            <p className="truncate text-xs text-muted-foreground">{field.definition.label}</p>
            <FieldValue field={field} />
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

function FieldValue({ field }: { field: RenderableField }) {
  const { definition, value } = field;

  if (definition.fieldType === "BOOLEAN") {
    return <p className="text-sm">{value === true ? "Yes" : "No"}</p>;
  }

  if (definition.fieldType === "DATE") {
    const date = fieldValueAsDate(value);
    return <p className="text-sm">{date ? formatPartialDate(date, "DAY") : "—"}</p>;
  }

  if (definition.fieldType === "MULTISELECT") {
    const list = fieldValueAsList(value);
    return (
      <div className="mt-0.5 flex flex-wrap gap-1">
        {list.map((item) => (
          <span
            key={item}
            className="inline-flex max-w-full rounded-full bg-muted px-1.5 py-0.5 text-[11px]"
          >
            <span className="truncate">{item}</span>
          </span>
        ))}
      </div>
    );
  }

  if (definition.fieldType === "URL" && typeof value === "string") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="block truncate text-sm text-accent-11 underline underline-offset-2"
      >
        {value}
      </a>
    );
  }

  if (definition.fieldType === "LONGTEXT" && typeof value === "string") {
    return <p className="whitespace-pre-wrap break-words text-sm">{value}</p>;
  }

  return <p className="truncate text-sm">{String(value ?? "—")}</p>;
}
