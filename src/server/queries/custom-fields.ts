import "server-only";
import { cache } from "react";
import type { CustomFieldEntity, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  contactPrivacyWhere,
  interactionPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/where";
import { appliesTo } from "@/lib/custom-fields";

const DEFINITION_SELECT = {
  id: true,
  entity: true,
  key: true,
  label: true,
  description: true,
  fieldType: true,
  options: true,
  appliesToCategoryIds: true,
  sortOrder: true,
  isActive: true,
} satisfies Prisma.CustomFieldDefinitionSelect;

export type FieldDefinition = Prisma.CustomFieldDefinitionGetPayload<{
  select: typeof DEFINITION_SELECT;
}>;

export interface FieldWithValue {
  definition: FieldDefinition;
  value: unknown;
}

/**
 * Definitions for one entity type.
 *
 * Inactive definitions are excluded by default: deactivating is how a field is
 * retired, and it must stop appearing on forms without destroying the values
 * already recorded against it.
 */
export const listFieldDefinitions = cache(
  async (
    ownerId: string,
    entity: CustomFieldEntity,
    opts: { includeInactive?: boolean } = {},
  ): Promise<FieldDefinition[]> =>
    prisma.customFieldDefinition.findMany({
      where: { ownerId, entity, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: DEFINITION_SELECT,
    }),
);

/** Every definition, grouped by entity — for the settings screen. */
export async function listAllFieldDefinitions(
  ownerId: string,
): Promise<Record<CustomFieldEntity, FieldDefinition[]>> {
  const rows = await prisma.customFieldDefinition.findMany({
    where: { ownerId },
    orderBy: [{ entity: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    select: DEFINITION_SELECT,
  });

  const out = {
    CONTACT: [],
    ROMANTIC: [],
    INTERACTION: [],
    DATE_ENTRY: [],
  } as Record<CustomFieldEntity, FieldDefinition[]>;
  for (const row of rows) out[row.entity].push(row);
  return out;
}

/**
 * The fields to show for one record, each paired with its current value.
 *
 * Scoped definitions are filtered by `categoryId` here rather than in the
 * component, so a field that does not apply is never fetched or rendered.
 */
export async function fieldsFor(
  ownerId: string,
  entity: CustomFieldEntity,
  entityId: string | null,
  opts: { categoryId?: string | null } = {},
): Promise<FieldWithValue[]> {
  const definitions = await listFieldDefinitions(ownerId, entity);
  const applicable =
    entity === "CONTACT"
      ? definitions.filter((definition) => appliesTo(definition, opts.categoryId))
      : definitions;
  if (applicable.length === 0) return [];

  // A record that does not exist yet (a create form) has no values.
  if (!entityId) return applicable.map((definition) => ({ definition, value: null }));

  const values = await prisma.customFieldValue.findMany({
    where: { ownerId, entityType: entity, entityId },
    select: { definitionId: true, value: true },
  });
  const byDefinition = new Map(values.map((row) => [row.definitionId, row.value]));

  return applicable.map((definition) => ({
    definition,
    value: byDefinition.get(definition.id) ?? null,
  }));
}

/**
 * Values for many records at once, keyed by entity id.
 *
 * Used by list views so rendering N rows does not cost N queries.
 */
export async function fieldValuesForMany(
  ownerId: string,
  entity: CustomFieldEntity,
  entityIds: string[],
): Promise<Map<string, Map<string, unknown>>> {
  const out = new Map<string, Map<string, unknown>>();
  if (entityIds.length === 0) return out;

  const values = await prisma.customFieldValue.findMany({
    where: { ownerId, entityType: entity, entityId: { in: entityIds } },
    select: { definitionId: true, entityId: true, value: true },
  });

  for (const row of values) {
    const byDefinition = out.get(row.entityId) ?? new Map<string, unknown>();
    byDefinition.set(row.definitionId, row.value);
    out.set(row.entityId, byDefinition);
  }
  return out;
}

/**
 * How many values each definition holds, for the Fields tab's delete warning.
 *
 * Privacy-filtered, because Settings stays reachable while the lock is closed:
 * an unfiltered tally answers "how many private people have this filled in"
 * from a page the lock does not gate. `entityId` is not a foreign key, so this
 * cannot be a join — the visible ids are gathered per entity and matched.
 *
 * `ROMANTIC` and `DATE_ENTRY` report nothing at all while locked rather than a
 * filtered number, because the dating module is hidden whole rather than
 * row-by-row.
 */
export async function valueCountsByDefinition(
  ownerId: string,
  scope: PrivacyScope,
): Promise<Map<string, number>> {
  const where: Prisma.CustomFieldValueWhereInput = { ownerId };

  if (scope.enabled && !scope.unlocked) {
    const [contacts, interactions] = await Promise.all([
      prisma.contact.findMany({
        where: { ownerId, ...contactPrivacyWhere(scope) },
        select: { id: true },
      }),
      prisma.interaction.findMany({
        where: { ownerId, ...interactionPrivacyWhere(scope) },
        select: { id: true },
      }),
    ]);
    const contactIds = contacts.map((row) => row.id);
    const interactionIds = interactions.map((row) => row.id);

    where.OR = [
      { entityType: "CONTACT", entityId: { in: contactIds } },
      { entityType: "INTERACTION", entityId: { in: interactionIds } },
    ];
  }

  const rows = await prisma.customFieldValue.groupBy({
    by: ["definitionId"],
    where,
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.definitionId, row._count._all]));
}
