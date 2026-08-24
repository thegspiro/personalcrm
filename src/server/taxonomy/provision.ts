import type { Prisma, TaxonomyKind } from "@prisma/client";
import { TAXONOMY_SEEDS } from "./defaults";

type Tx = Prisma.TransactionClient;

/**
 * Create the starter taxonomy terms for a user.
 *
 * Idempotent: existing slugs are left exactly as the user has them, so this can
 * safely run again after an upgrade adds new default terms.
 */
export async function provisionTaxonomies(tx: Tx, ownerId: string): Promise<void> {
  const existing = await tx.taxonomyTerm.findMany({
    where: { ownerId },
    select: { kind: true, slug: true },
  });
  const have = new Set(existing.map((t) => `${t.kind}:${t.slug}`));

  const rows: Prisma.TaxonomyTermCreateManyInput[] = [];
  for (const [kind, seeds] of Object.entries(TAXONOMY_SEEDS) as [TaxonomyKind, typeof TAXONOMY_SEEDS[TaxonomyKind]][]) {
    seeds.forEach((seed, index) => {
      if (have.has(`${kind}:${seed.slug}`)) return;
      rows.push({
        ownerId,
        kind,
        slug: seed.slug,
        label: seed.label,
        icon: seed.icon ?? null,
        color: seed.color ?? null,
        sortOrder: index,
        isSystem: true,
        metadata: (seed.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      });
    });
  }

  if (rows.length > 0) {
    await tx.taxonomyTerm.createMany({ data: rows });
  }

  await linkRelationshipInverses(tx, ownerId);
}

/**
 * Wire each RELATIONSHIP_TYPE term to its reciprocal, so adding "Alice is
 * Bob's parent" can also write "Bob is Alice's child".
 */
export async function linkRelationshipInverses(tx: Tx, ownerId: string): Promise<void> {
  const terms = await tx.taxonomyTerm.findMany({
    where: { ownerId, kind: "RELATIONSHIP_TYPE" },
    select: { id: true, slug: true, inverseTermId: true },
  });
  const bySlug = new Map(terms.map((t) => [t.slug, t]));

  for (const seed of TAXONOMY_SEEDS.RELATIONSHIP_TYPE) {
    if (!seed.inverse) continue;
    const term = bySlug.get(seed.slug);
    const inverse = bySlug.get(seed.inverse);
    if (!term || !inverse || term.inverseTermId === inverse.id) continue;
    await tx.taxonomyTerm.update({
      where: { id: term.id },
      data: { inverseTermId: inverse.id },
    });
  }
}
