import type { Prisma, TaxonomyKind } from "@prisma/client";
import { TAXONOMY_SEEDS, type TaxonomySeed } from "./defaults";

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

  await refreshSystemTermMetadata(tx, ownerId);
  await linkRelationshipInverses(tx, ownerId);
}

/**
 * Backfill seed metadata onto system terms that predate it.
 *
 * provisionTaxonomies deliberately skips slugs that already exist, so an
 * upgrade that adds metadata to an *existing* seed — as the family work did to
 * `parent`, `sibling` and friends — would otherwise only reach new accounts.
 *
 * Only untouched system terms are considered, and keys already on the row win,
 * so nothing the user has set is overwritten.
 */
export async function refreshSystemTermMetadata(tx: Tx, ownerId: string): Promise<void> {
  const seeded = new Map<string, Record<string, unknown>>();
  for (const [kind, seeds] of Object.entries(TAXONOMY_SEEDS) as [TaxonomyKind, TaxonomySeed[]][]) {
    for (const seed of seeds) {
      if (seed.metadata) seeded.set(`${kind}:${seed.slug}`, seed.metadata);
    }
  }

  const terms = await tx.taxonomyTerm.findMany({
    where: { ownerId, isSystem: true },
    select: { id: true, kind: true, slug: true, metadata: true },
  });

  for (const term of terms) {
    const seed = seeded.get(`${term.kind}:${term.slug}`);
    if (!seed) continue;
    const current =
      term.metadata && typeof term.metadata === "object" && !Array.isArray(term.metadata)
        ? (term.metadata as Record<string, unknown>)
        : {};
    const missing = Object.keys(seed).filter((key) => !(key in current));
    if (missing.length === 0) continue;
    await tx.taxonomyTerm.update({
      where: { id: term.id },
      data: { metadata: { ...seed, ...current } as Prisma.InputJsonValue },
    });
  }
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
