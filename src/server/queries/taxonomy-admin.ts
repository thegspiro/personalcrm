import "server-only";
import type { TaxonomyKind } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listTermsByKind, type Term } from "@/server/taxonomy/queries";
import { TAXONOMY_KIND_ORDER } from "@/server/taxonomy/defaults";
import {
  contactPrivacyWhere,
  factPrivacyWhere,
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  viaOptionalContactPrivacyWhere,
} from "@/server/privacy/filter";

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
 *
 * Every one of them is privacy-filtered. Settings stays reachable while the
 * lock is closed, so an unfiltered tally answers "how many private people are
 * filed under this" from a page the lock does not gate — the reason the
 * invariant covers counts and not only rows. The dating relations are withheld
 * whole rather than filtered, because the module itself is.
 */
export async function listTaxonomyAdmin(ownerId: string): Promise<TaxonomyGroup[]> {
  const byKind = await listTermsByKind(ownerId, TAXONOMY_KIND_ORDER, { includeInactive: true });
  const scope = await privacyScope();
  const visible = !scope.enabled || scope.unlocked;
  const empty: Array<Record<string, unknown> & { _count: { _all: number } }> = [];

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
    plans,
  ] = await Promise.all([
    prisma.contact.groupBy({
      by: ["categoryId"],
      where: { ownerId, ...contactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["meetingSourceId"],
      where: { ownerId, ...contactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.contactMethod.groupBy({
      by: ["typeId"],
      where: { contact: { ownerId, ...contactPrivacyWhere(scope) } },
      _count: { _all: true },
    }),
    prisma.interaction.groupBy({
      by: ["typeId"],
      where: { ownerId, ...interactionPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.fact.groupBy({
      by: ["categoryId"],
      where: { ownerId, ...factPrivacyWhere(scope), ...viaContactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.importantDate.groupBy({
      by: ["typeId"],
      where: { ownerId, ...viaContactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.relationship.groupBy({
      by: ["typeId"],
      // Two contacts, either of which hides the link: the pair is the fact.
      where: {
        ownerId,
        ...(visible
          ? {}
          : { fromContact: { isPrivate: false }, toContact: { isPrivate: false } }),
      },
      _count: { _all: true },
    }),
    // The dating module is hidden whole while locked, so its taxonomies are
    // not filtered down — they report nothing at all.
    visible
      ? prisma.romanticProfile.groupBy({ by: ["stageId"], where: { ownerId }, _count: { _all: true } })
      : empty,
    visible
      ? prisma.dateEntry.groupBy({ by: ["activityTypeId"], where: { ownerId }, _count: { _all: true } })
      : empty,
    visible
      ? prisma.romanticProfile.groupBy({ by: ["sourceId"], where: { ownerId }, _count: { _all: true } })
      : empty,
    prisma.gift.groupBy({
      by: ["occasionId"],
      // A gift always has a contact; a plan need not.
      where: { ownerId, ...viaContactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.lifeEvent.groupBy({
      by: ["typeId"],
      // Not `viaContactPrivacyWhere`: an event anchored to a public contact can
      // still name a private participant, and the timeline hides it on that
      // basis. Counting it here reported the hidden event's type and quantity.
      where: { ownerId, ...lifeEventPrivacyWhere(scope) },
      _count: { _all: true },
    }),
    prisma.plan.groupBy({
      by: ["categoryId"],
      where: { ownerId, ...viaOptionalContactPrivacyWhere(scope) },
      _count: { _all: true },
    }),
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
  tally(plans, "categoryId");

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
