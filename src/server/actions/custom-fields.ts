"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type CustomFieldEntity, type CustomFieldType } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner, str, strList } from "./helpers";
import { slugifyFieldKey } from "@/lib/custom-fields";

/**
 * Defining your own fields.
 *
 * Definitions are per-account and referenced by id everywhere, so renaming a
 * field never orphans its values. Retiring one deactivates it rather than
 * deleting it — see `setFieldActive`.
 */

const ENTITIES: CustomFieldEntity[] = ["CONTACT", "ROMANTIC", "INTERACTION", "DATE_ENTRY"];
const TYPES: CustomFieldType[] = [
  "TEXT",
  "LONGTEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "URL",
];

/** Types whose definition carries a list of choices. */
const OPTION_TYPES: CustomFieldType[] = ["SELECT", "MULTISELECT"];

function touch() {
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/people", "layout");
}

function parseEntity(value?: string): CustomFieldEntity | null {
  return ENTITIES.includes(value as CustomFieldEntity) ? (value as CustomFieldEntity) : null;
}

function parseType(value?: string): CustomFieldType | null {
  return TYPES.includes(value as CustomFieldType) ? (value as CustomFieldType) : null;
}

/** Options arrive as one per line — the least fiddly thing to type on a phone. */
function parseOptionList(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const option = line.trim();
    if (!option || seen.has(option)) continue;
    seen.add(option);
    out.push(option);
  }
  return out;
}

export async function createFieldDefinition(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const entity = parseEntity(str(form, "entity"));
  const fieldType = parseType(str(form, "fieldType"));
  const label = str(form, "label");

  if (!entity) return fail("Pick what this field is for.");
  if (!fieldType) return fail("Pick a field type.");
  if (!label) return fail("Give the field a name.");

  const options = OPTION_TYPES.includes(fieldType)
    ? parseOptionList(str(form, "options"))
    : [];
  if (OPTION_TYPES.includes(fieldType) && options.length === 0) {
    return fail("A choice field needs at least one choice.");
  }

  // Keys are derived once and then frozen, so a later rename cannot break an
  // export or an import that matches on them.
  const base = slugifyFieldKey(label);
  const taken = await prisma.customFieldDefinition.findMany({
    where: { ownerId, entity, key: { startsWith: base } },
    select: { key: true },
  });
  const used = new Set(taken.map((row) => row.key));
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;

  const last = await prisma.customFieldDefinition.findFirst({
    where: { ownerId, entity },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.customFieldDefinition.create({
    data: {
      ownerId,
      entity,
      key,
      label,
      description: str(form, "description") ?? null,
      fieldType,
      options: options.length > 0 ? (options as Prisma.InputJsonValue) : Prisma.DbNull,
      appliesToCategoryIds:
        entity === "CONTACT" && strList(form, "appliesToCategoryIds").length > 0
          ? (strList(form, "appliesToCategoryIds") as Prisma.InputJsonValue)
          : Prisma.DbNull,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  touch();
  return ok(created);
}

export async function updateFieldDefinition(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const label = str(form, "label");
  if (!id) return fail("Not found.");
  if (!label) return fail("Give the field a name.");

  const existing = await prisma.customFieldDefinition.findFirst({
    where: { id, ownerId },
    select: { id: true, entity: true, fieldType: true, options: true },
  });
  if (!existing) return fail("Not found.");

  // The type is fixed after creation: changing it would leave every stored
  // value the wrong shape, and silently reinterpreting them is worse than
  // asking someone to make a new field.
  const data: Prisma.CustomFieldDefinitionUpdateInput = {
    label,
    description: str(form, "description") ?? null,
  };

  if (OPTION_TYPES.includes(existing.fieldType)) {
    const options = parseOptionList(str(form, "options"));
    if (options.length === 0) return fail("A choice field needs at least one choice.");
    data.options = options as Prisma.InputJsonValue;
  }

  if (existing.entity === "CONTACT") {
    const categories = strList(form, "appliesToCategoryIds");
    data.appliesToCategoryIds =
      categories.length > 0 ? (categories as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  await prisma.customFieldDefinition.update({ where: { id }, data });

  touch();
  return ok();
}

/**
 * Retire or restore a field.
 *
 * Deactivating hides it from every form while leaving its values intact, so
 * turning it back on brings the history with it. That is what makes this
 * different from deleting.
 */
export async function setFieldActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.customFieldDefinition.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.customFieldDefinition.update({ where: { id }, data: { isActive } });

  touch();
  return ok();
}

/**
 * Delete a field and everything recorded in it.
 *
 * Genuinely destructive — `CustomFieldValue` cascades — so the UI confirms
 * with the value count first. Deactivating is the reversible option.
 */
export async function deleteFieldDefinition(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.customFieldDefinition.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.customFieldDefinition.delete({ where: { id } });

  touch();
  return ok();
}

/** Move a field one place up or down within its entity. */
export async function moveFieldDefinition(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const current = await prisma.customFieldDefinition.findFirst({
    where: { id, ownerId },
    select: { id: true, entity: true, sortOrder: true },
  });
  if (!current) return fail("Not found.");

  const neighbour = await prisma.customFieldDefinition.findFirst({
    where: {
      ownerId,
      entity: current.entity,
      sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });
  // Already at the end — not an error, just nothing to do.
  if (!neighbour) return ok();

  await prisma.$transaction([
    prisma.customFieldDefinition.update({
      where: { id: current.id },
      data: { sortOrder: neighbour.sortOrder },
    }),
    prisma.customFieldDefinition.update({
      where: { id: neighbour.id },
      data: { sortOrder: current.sortOrder },
    }),
  ]);

  touch();
  return ok();
}
