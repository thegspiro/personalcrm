"use server";

import { revalidatePath } from "next/cache";
import type { TaxonomyKind } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner, str } from "./helpers";
import { TAXONOMY_KIND_ORDER } from "@/server/taxonomy/defaults";
import { linkRelationshipInverses } from "@/server/taxonomy/provision";
import { slugifyFieldKey } from "@/lib/custom-fields";

/**
 * Editing your own taxonomies.
 *
 * Every "type" in the app is a TaxonomyTerm row, so this is where the labels,
 * colours and icons you see everywhere actually come from.
 *
 * Three rules the data model depends on:
 *
 *  1. Terms in use are deactivated, never deleted. The foreign keys are
 *     `SetNull` or `Cascade`, so deleting one would quietly rewrite history —
 *     an interaction would lose its type, or worse, disappear.
 *  2. A RELATIONSHIP_TYPE keeps its reciprocal pairing. Relationships are
 *     stored in both directions, and an unpaired term leaves one half of every
 *     future link untyped.
 *  3. `metadata` is not editable here. Family tiers and generations, and the
 *     dating pipeline's ordering, are read from it by code that would break in
 *     non-obvious ways if the values were free text.
 */

function touch() {
  revalidatePath("/", "layout");
}

function parseKind(value?: string): TaxonomyKind | null {
  return TAXONOMY_KIND_ORDER.includes(value as TaxonomyKind) ? (value as TaxonomyKind) : null;
}

export async function createTerm(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const kind = parseKind(str(form, "kind"));
  const label = str(form, "label");
  if (!kind) return fail("Unknown taxonomy.");
  if (!label) return fail("Give it a name.");

  const base = slugifyFieldKey(label);
  const taken = await prisma.taxonomyTerm.findMany({
    where: { ownerId, kind, slug: { startsWith: base } },
    select: { slug: true },
  });
  const used = new Set(taken.map((row) => row.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;

  const last = await prisma.taxonomyTerm.findFirst({
    where: { ownerId, kind },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.taxonomyTerm.create({
    data: {
      ownerId,
      kind,
      slug,
      label,
      icon: str(form, "icon") ?? null,
      color: str(form, "color") ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      isSystem: false,
    },
    select: { id: true },
  });

  // A new relationship type is symmetric until told otherwise — "cousin" and
  // "friend" both invert to themselves, which is the common case.
  if (kind === "RELATIONSHIP_TYPE") {
    const inverseId = str(form, "inverseTermId");
    await setInversePair(ownerId, created.id, inverseId ?? created.id);
  }

  touch();
  return ok(created);
}

export async function updateTerm(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const label = str(form, "label");
  if (!id) return fail("Not found.");
  if (!label) return fail("Give it a name.");

  const existing = await prisma.taxonomyTerm.findFirst({
    where: { id, ownerId },
    select: { id: true, kind: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.taxonomyTerm.update({
    where: { id },
    data: {
      label,
      icon: str(form, "icon") ?? null,
      color: str(form, "color") ?? null,
    },
  });

  if (existing.kind === "RELATIONSHIP_TYPE" && form.has("inverseTermId")) {
    const inverseId = str(form, "inverseTermId") ?? id;
    const result = await setInversePair(ownerId, id, inverseId);
    if (!result.ok) return result;
  }

  touch();
  return ok();
}

/**
 * Retire or restore a term.
 *
 * Deactivating hides it from every picker while leaving every row that already
 * uses it intact and readable. This is the safe alternative to deleting, and
 * the one the UI leads with.
 */
export async function setTermActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.taxonomyTerm.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.taxonomyTerm.update({ where: { id }, data: { isActive } });

  touch();
  return ok();
}

/**
 * Delete a term outright.
 *
 * Refused while anything still uses it: the foreign keys would either null the
 * reference or cascade the row away, and silently rewriting history is not
 * something a rename screen should be able to do. Deactivate instead.
 */
export async function deleteTerm(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.taxonomyTerm.findFirst({
    where: { id, ownerId },
    select: { id: true, kind: true },
  });
  if (!existing) return fail("Not found.");

  const inUse = await termUsageCount(id, existing.kind);
  if (inUse > 0) {
    return fail(
      `${inUse} ${inUse === 1 ? "record uses" : "records use"} this. Turn it off instead — that hides it without touching them.`,
    );
  }

  await prisma.taxonomyTerm.delete({ where: { id } });

  touch();
  return ok();
}

/** Move a term one place up or down within its kind. */
export async function moveTerm(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const { ownerId } = await owner();
  const current = await prisma.taxonomyTerm.findFirst({
    where: { id, ownerId },
    select: { id: true, kind: true, sortOrder: true },
  });
  if (!current) return fail("Not found.");

  const neighbour = await prisma.taxonomyTerm.findFirst({
    where: {
      ownerId,
      kind: current.kind,
      sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });
  if (!neighbour) return ok();

  await prisma.$transaction([
    prisma.taxonomyTerm.update({
      where: { id: current.id },
      data: { sortOrder: neighbour.sortOrder },
    }),
    prisma.taxonomyTerm.update({
      where: { id: neighbour.id },
      data: { sortOrder: current.sortOrder },
    }),
  ]);

  touch();
  return ok();
}

/**
 * Put back any default term that has been deleted.
 *
 * Restores across every taxonomy at once, because that is what
 * `provisionTaxonomies` does: it skips slugs that already exist, so whatever
 * you have renamed, recoloured or turned off is left exactly as it is.
 */
export async function restoreMissingDefaults(): Promise<ActionResult> {
  const { ownerId } = await owner();
  const { provisionTaxonomies } = await import("@/server/taxonomy/provision");
  await prisma.$transaction((tx) => provisionTaxonomies(tx, ownerId));

  touch();
  return ok();
}

/**
 * Point two relationship terms at each other.
 *
 * Both directions are written, because a one-way pairing means the reciprocal
 * half of a link gets the wrong type. Repointing a term away from its old
 * partner leaves that partner self-inverse rather than dangling.
 */
async function setInversePair(
  ownerId: string,
  termId: string,
  inverseId: string,
): Promise<ActionResult> {
  const [term, inverse] = await Promise.all([
    prisma.taxonomyTerm.findFirst({
      where: { id: termId, ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, inverseTermId: true },
    }),
    prisma.taxonomyTerm.findFirst({
      where: { id: inverseId, ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, inverseTermId: true },
    }),
  ]);
  if (!term || !inverse) return fail("Unknown relationship type.");

  await prisma.$transaction(async (tx) => {
    // Whoever the old partner was is now unpaired; make it symmetric rather
    // than leaving it pointing at a term that no longer points back.
    const orphans = [term.inverseTermId, inverse.inverseTermId].filter(
      (id): id is string => Boolean(id) && id !== term.id && id !== inverse.id,
    );
    for (const orphanId of orphans) {
      await tx.taxonomyTerm.update({
        where: { id: orphanId },
        data: { inverseTermId: orphanId },
      });
    }

    await tx.taxonomyTerm.update({
      where: { id: term.id },
      data: { inverseTermId: inverse.id },
    });
    await tx.taxonomyTerm.update({
      where: { id: inverse.id },
      data: { inverseTermId: term.id },
    });

    // Re-assert the seeded pairings, so a system term that was knocked loose
    // above goes back where it belongs.
    await linkRelationshipInverses(tx, ownerId);
  });

  return ok();
}

/**
 * How many rows point at a term.
 *
 * Counted per kind because the relations differ — there is no generic "things
 * that reference this term" query.
 */
async function termUsageCount(id: string, kind: TaxonomyKind): Promise<number> {
  switch (kind) {
    case "CONTACT_CATEGORY":
      return prisma.contact.count({ where: { categoryId: id } });
    case "CONTACT_METHOD_TYPE":
      return prisma.contactMethod.count({ where: { typeId: id } });
    case "INTERACTION_TYPE":
      return prisma.interaction.count({ where: { typeId: id } });
    case "FACT_CATEGORY":
      return prisma.fact.count({ where: { categoryId: id } });
    case "DATE_TYPE":
      return prisma.importantDate.count({ where: { typeId: id } });
    case "RELATIONSHIP_TYPE":
      return prisma.relationship.count({ where: { typeId: id } });
    case "DATING_STAGE":
      return prisma.romanticProfile.count({ where: { stageId: id } });
    case "DATE_ACTIVITY_TYPE":
      return prisma.dateEntry.count({ where: { activityTypeId: id } });
    case "PLAN_CATEGORY":
      return prisma.plan.count({ where: { categoryId: id } });
    case "MEETING_SOURCE":
      return (
        (await prisma.contact.count({ where: { meetingSourceId: id } })) +
        (await prisma.romanticProfile.count({ where: { sourceId: id } }))
      );
    case "GIFT_OCCASION":
      return prisma.gift.count({ where: { occasionId: id } });
    case "LIFE_EVENT_TYPE":
      return prisma.lifeEvent.count({ where: { typeId: id } });
    default:
      return 0;
  }
}
