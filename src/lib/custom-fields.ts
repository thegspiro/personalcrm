/**
 * Custom field values: coercion, validation and display.
 *
 * Values are stored as `Json`, which means the database will accept anything.
 * This module is the only place that decides what a value of a given type may
 * be, so a field defined as a NUMBER cannot end up holding "banana" via a
 * hand-rolled form post — server actions are public endpoints and the browser
 * is not a validator.
 *
 * Pure and free of Prisma so it can be unit-tested directly.
 */
import type { CustomFieldType } from "@prisma/client";
import { parsePlainDate, plainDateKey, type PlainDate } from "./dates";

/**
 * Hidden input naming the definitions a form actually rendered.
 *
 * Needed because absence in a FormData is ambiguous: an unchecked checkbox and
 * a field that was never on screen look identical. Without this marker, saving
 * from a form that omits custom fields would silently clear every boolean.
 */
export const RENDERED_FIELDS_INPUT = "cf_rendered";

/** Caps on stored text. The column is JSON, so nothing else imposes a limit. */
export const TEXT_MAX = 500;
export const LONGTEXT_MAX = 5000;

/** Minimal shape of a definition — anything definition-like will do. */
export interface DefinitionLike {
  fieldType: CustomFieldType;
  options?: unknown;
  appliesToCategoryIds?: unknown;
}

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Option lists are stored as a JSON array; anything else reads as empty. */
export function fieldOptions(definition: Pick<DefinitionLike, "options">): string[] {
  const raw = definition.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter((option): option is string => typeof option === "string" && option !== "");
}

/**
 * Whether a field applies to a contact in a given category.
 *
 * An empty or absent list means "everyone" — that is what makes a field
 * general rather than scoped, and it is the default.
 */
export function appliesTo(
  definition: Pick<DefinitionLike, "appliesToCategoryIds">,
  categoryId: string | null | undefined,
): boolean {
  const raw = definition.appliesToCategoryIds;
  if (!Array.isArray(raw)) return true;
  const ids = raw.filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) return true;
  return categoryId ? ids.includes(categoryId) : false;
}

/**
 * Coerce a raw form value to the field's type.
 *
 * An empty submission clears the field rather than failing: leaving a box
 * blank is how you remove a value, and treating that as an error would make
 * custom fields impossible to unset.
 */
export function coerceFieldValue(definition: DefinitionLike, raw: unknown): CoerceResult {
  const { fieldType } = definition;

  if (fieldType === "BOOLEAN") {
    // Unchecked checkboxes are simply absent from a FormData, so "missing"
    // has to mean false here rather than "leave it alone".
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: false };
    return { ok: true, value: raw === "true" || raw === "on" || raw === "1" };
  }

  if (fieldType === "MULTISELECT") {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === "" ? [] : [raw];
    const allowed = fieldOptions(definition);
    const picked: string[] = [];
    for (const item of list) {
      if (typeof item !== "string" || item === "") continue;
      if (!allowed.includes(item)) return { ok: false, error: `"${item}" is not one of the choices.` };
      if (!picked.includes(item)) picked.push(item);
    }
    return { ok: true, value: picked.length === 0 ? null : picked };
  }

  if (raw === undefined || raw === null) return { ok: true, value: null };
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  if (text === "") return { ok: true, value: null };

  switch (fieldType) {
    case "TEXT":
      if (text.length > TEXT_MAX) return { ok: false, error: `Keep this under ${TEXT_MAX} characters.` };
      return { ok: true, value: text };

    case "LONGTEXT":
      if (text.length > LONGTEXT_MAX) {
        return { ok: false, error: `Keep this under ${LONGTEXT_MAX} characters.` };
      }
      return { ok: true, value: text };

    case "NUMBER": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return { ok: false, error: "That isn't a number." };
      return { ok: true, value: parsed };
    }

    case "DATE": {
      const date = parsePlainDate(text);
      if (!date) return { ok: false, error: "That isn't a date." };
      // Stored as a plain YYYY-MM-DD key, never a Date: these are calendar
      // dates, and round-tripping them through a timestamp shifts them across
      // a timezone boundary.
      return { ok: true, value: plainDateKey(date) };
    }

    case "SELECT": {
      const allowed = fieldOptions(definition);
      if (!allowed.includes(text)) return { ok: false, error: "That isn't one of the choices." };
      return { ok: true, value: text };
    }

    case "URL": {
      const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      try {
        const url = new URL(withScheme);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return { ok: false, error: "That isn't a web address." };
        }
        return { ok: true, value: url.toString() };
      } catch {
        return { ok: false, error: "That isn't a web address." };
      }
    }

    default:
      return { ok: false, error: "Unknown field type." };
  }
}

/** The stored value as a date, for rendering. Null when it isn't one. */
export function fieldValueAsDate(value: unknown): PlainDate | null {
  return typeof value === "string" ? parsePlainDate(value) : null;
}

/** The stored value as a list, for MULTISELECT rendering. */
export function fieldValueAsList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** True when a value counts as "not set" and the row can be removed. */
export function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Form field name for a definition.
 *
 * Prefixed and keyed by id rather than by the user's own `key`, so renaming a
 * field cannot collide with a built-in form field like `firstName`.
 */
export function fieldInputName(definitionId: string): string {
  return `cf_${definitionId}`;
}

/** The definition id behind a form field name, or null if it isn't one. */
export function definitionIdFromInputName(name: string): string | null {
  return name.startsWith("cf_") ? name.slice(3) : null;
}

/**
 * Turn a label into a stable key.
 *
 * The key is what an export or an import matches on, so it is derived once at
 * creation and then left alone — renaming the label must not change it.
 */
export function slugifyFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "field";
}
