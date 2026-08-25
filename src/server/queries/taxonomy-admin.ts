import "server-only";
import type { TaxonomyKind } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listTermsByKind, type Term } from "@/server/taxonomy/queries";
import { TAXONOMY_KIND_ORDER } from "@/server/taxonomy/defaults";

export interface AdminTerm extends Term {
  /** How many records point at this term. Zero means it is safe to delete. */
  usageCount: number;
  /** The reciprocal's label, for RELATIONSHIP_TYPE. */
  inverseLabel: string | null;
}

export interface TaxonomyGroup {
  kind: TaxonomyKind;
  terms: AdminTerm[];
}

/**
 * Every taxonomy with usage counts, for the settings screen.
 *
 * Counts are what let the UI lead with "turn this off" instead of offering a
 * delete that would quietly rewrite history. Gathered in one pass per relation
 * rather than per term, so a long list does not cost a query each.
 */
export async function listTaxonomyAdmin(ownerId: string): Promise<TaxonomyGroup[]> {
  const byKind = await listTermsByKind(ownerId, TAXONOMY_KIND_ORDER, { includeInactive: true });

  const [
    contactCategories,
    meetingSourcesOnContacts,
    methods,
    interactions,
    facts,
    dates,
    relationships,
    stages,
    activities,
    sourcesOnProfiles,
    gifts,
    lifeEvents,
    dateIdeas,
  ] = await Promise.all([
    prisma.contact.groupBy({ by: ["categoryId"], where: { ownerId }, _count: { _all: true } }),
    prisma.contact.groupBy({ by: ["meetingSourceId"], where: { ownerId }, _count: { _all: true } }),
    prisma.contactMethod.groupBy({ by: ["typeId"], where: { contact: { ownerId } }, _count: { _all: true } }),
    prisma.interaction.groupBy({ by: ["typeId"], where: { ownerId }, _count: { _all: true } }),
    prisma.fact.groupBy({ by: ["categoryId"], where: { ownerId }, _count: { _all: true } }),
    prisma.importantDate.groupBy({ by: ["typeId"], where: { ownerId }, _count: { _all: true } }),
    prisma.relationship.groupBy({ by: ["typeId"], where: { ownerId }, _count: { _all: true } }),
    prisma.romanticProfile.groupBy({ by: ["stageId"], where: { ownerId }, _count: { _all: true } }),
    prisma.dateEntry.groupBy({ by: ["activityTypeId"], where: { ownerId }, _count: { _all: true } }),
    prisma.romanticProfile.groupBy({ by: ["sourceId"], where: { ownerId }, _count: { _all: true } }),
    prisma.gift.groupBy({ by: ["occasionId"], where: { ownerId }, _count: { _all: true } }),
    prisma.lifeEvent.groupBy({ by: ["typeId"], where: { ownerId }, _count: { _all: true } }),
    prisma.dateIdea.groupBy({ by: ["categoryId"], where: { ownerId }, _count: { _all: true } }),
  ]);

  const counts = new Map<string, number>();
  const tally = (
    rows: Array<Record<string, unknown> & { _count: { _all: number } }>,
    key: string,
  ) => {
    for (const row of rows) {
      const id = row[key];
      // Rows with a null term are simply uncategorised — nothing to count.
      if (typeof id !== "string") continue;
      counts.set(id, (counts.get(id) ?? 0) + row._count._all);
    }
  };

  tally(contactCategories, "categoryId");
  tally(meetingSourcesOnContacts, "meetingSourceId");
  tally(methods, "typeId");
  tally(interactions, "typeId");
  tally(facts, "categoryId");
  tally(dates, "typeId");
  tally(relationships, "typeId");
  tally(stages, "stageId");
  tally(activities, "activityTypeId");
  tally(sourcesOnProfiles, "sourceId");
  tally(gifts, "occasionId");
  tally(lifeEvents, "typeId");
  tally(dateIdeas, "categoryId");

  const labels = new Map<string, string>();
  for (const kind of TAXONOMY_KIND_ORDER) {
    for (const term of byKind[kind] ?? []) labels.set(term.id, term.label);
  }

  return TAXONOMY_KIND_ORDER.map((kind) => ({
    kind,
    terms: (byKind[kind] ?? []).map((term) => ({
      ...term,
      usageCount: counts.get(term.id) ?? 0,
      inverseLabel: term.inverseTermId ? (labels.get(term.inverseTermId) ?? null) : null,
    })),
  }));
}
