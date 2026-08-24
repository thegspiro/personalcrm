import type { CustomFieldEntity, Prisma } from "@prisma/client";
import {
  coerceFieldValue,
  fieldInputName,
  isEmptyFieldValue,
  RENDERED_FIELDS_INPUT,
} from "@/lib/custom-fields";

export { RENDERED_FIELDS_INPUT };

type Tx = Prisma.TransactionClient;


export type SaveFieldsResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string> };

/** The definition ids a form declared it rendered. */
export function renderedFieldIds(form: FormData): string[] {
  const raw = form.get(RENDERED_FIELDS_INPUT);
  if (typeof raw !== "string" || raw === "") return [];
  return raw.split(",").filter(Boolean);
}

/**
 * Write the custom field values submitted alongside a record.
 *
 * Takes a transaction client so it can run inside the same transaction as the
 * record it belongs to — a contact that saves but whose custom fields silently
 * don't is worse than a failure.
 *
 * Only definitions the owner actually has *and* that the form declared it
 * rendered are considered, and every value goes through `coerceFieldValue`. A
 * form post naming a definition id from another account, or a value of the
 * wrong type, is ignored or rejected rather than trusted: server actions are
 * public POST endpoints.
 */
export async function saveCustomFieldValues(
  tx: Tx,
  ownerId: string,
  entity: CustomFieldEntity,
  entityId: string,
  form: FormData,
): Promise<SaveFieldsResult> {
  const rendered = renderedFieldIds(form);
  if (rendered.length === 0) return { ok: true };

  const definitions = await tx.customFieldDefinition.findMany({
    where: { ownerId, entity, isActive: true, id: { in: rendered } },
    select: { id: true, label: true, fieldType: true, options: true },
  });
  if (definitions.length === 0) return { ok: true };

  const fieldErrors: Record<string, string> = {};
  const writes: Array<{ definitionId: string; value: unknown }> = [];
  const clears: string[] = [];

  for (const definition of definitions) {
    const name = fieldInputName(definition.id);
    const raw =
      definition.fieldType === "MULTISELECT"
        ? form.getAll(name).map((entry) => (typeof entry === "string" ? entry : ""))
        : form.get(name);

    const result = coerceFieldValue(definition, raw);
    if (!result.ok) {
      fieldErrors[name] = `${definition.label}: ${result.error}`;
      continue;
    }

    if (isEmptyFieldValue(result.value)) clears.push(definition.id);
    else writes.push({ definitionId: definition.id, value: result.value });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // Clearing removes the row rather than storing null, so "no value" has one
  // representation and a definition's value count means what it says.
  if (clears.length > 0) {
    await tx.customFieldValue.deleteMany({
      where: { ownerId, entityType: entity, entityId, definitionId: { in: clears } },
    });
  }

  for (const write of writes) {
    await tx.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId: write.definitionId, entityId } },
      create: {
        ownerId,
        definitionId: write.definitionId,
        entityType: entity,
        entityId,
        value: write.value as Prisma.InputJsonValue,
      },
      update: { value: write.value as Prisma.InputJsonValue },
    });
  }

  return { ok: true };
}

/**
 * Thrown when a submitted custom field value is the wrong shape.
 *
 * Thrown rather than returned so it aborts the surrounding transaction: a
 * contact that saves while one of its custom fields silently doesn't is worse
 * than the whole save failing.
 */
export class CustomFieldValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Custom field validation failed");
    this.name = "CustomFieldValidationError";
  }
}

/** {@link saveCustomFieldValues}, aborting the transaction on bad input. */
export async function saveCustomFieldValuesOrThrow(
  tx: Tx,
  ownerId: string,
  entity: CustomFieldEntity,
  entityId: string,
  form: FormData,
): Promise<void> {
  const result = await saveCustomFieldValues(tx, ownerId, entity, entityId, form);
  if (!result.ok) throw new CustomFieldValidationError(result.fieldErrors);
}

/**
 * Turn a caught error into an action result, or null if it wasn't ours.
 *
 * Lets an action write `const failure = customFieldFailure(error); if (failure)
 * return failure; throw error;` without swallowing unrelated failures.
 */
export function customFieldFailure(
  error: unknown,
): { ok: false; error: string; fieldErrors: Record<string, string> } | null {
  if (!(error instanceof CustomFieldValidationError)) return null;
  return {
    ok: false,
    error: "Please check the highlighted fields.",
    fieldErrors: error.fieldErrors,
  };
}

/**
 * Remove the custom field values belonging to a deleted record.
 *
 * `CustomFieldValue.entityId` is a plain string, not a foreign key — it has to
 * be, because one table points at four others. That means nothing cascades,
 * and without this the values of every deleted contact, interaction and date
 * would sit in the database forever and turn up in an export.
 *
 * Deleting a contact takes its interactions and dates with it, so those have
 * to be swept too; pass their ids alongside.
 */
export async function deleteCustomFieldValues(
  tx: Tx,
  ownerId: string,
  entries: Array<{ entity: CustomFieldEntity; entityIds: string[] }>,
): Promise<void> {
  for (const entry of entries) {
    if (entry.entityIds.length === 0) continue;
    await tx.customFieldValue.deleteMany({
      where: { ownerId, entityType: entry.entity, entityId: { in: entry.entityIds } },
    });
  }
}
