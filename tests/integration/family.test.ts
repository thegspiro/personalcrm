import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";
import { provisionTaxonomies, refreshSystemTermMetadata } from "@/server/taxonomy/provision";
import { endedRole, familyMeta, isEndedRole } from "@/lib/family";
import { endFamilyPair } from "@/server/services/family-links";

/**
 * The family layer against a real database.
 *
 * The taxonomy assertions matter more than they look: every family feature —
 * tier grouping, generation banding, inference — reads term metadata rather
 * than slugs, so a seed that ships without it silently disables all three.
 */
describe.skipIf(!hasTestDatabase)("family taxonomy", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  it("seeds the extended, in-law, step and chosen family terms", async () => {
    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { slug: true, metadata: true },
    });
    const bySlug = new Map(terms.map((t) => [t.slug, t]));

    for (const slug of [
      "aunt-uncle",
      "niece-nephew",
      "cousin",
      "parent-in-law",
      "child-in-law",
      "sibling-in-law",
      "stepparent",
      "stepchild",
      "stepsibling",
      "half-sibling",
      "godparent",
      "godchild",
      "chosen-family",
    ]) {
      expect(bySlug.has(slug), `missing seed: ${slug}`).toBe(true);
      expect(familyMeta(bySlug.get(slug)!), `no family metadata: ${slug}`).not.toBeNull();
    }
  });

  it("gives every family term a tier, a generation and a role", async () => {
    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { slug: true, metadata: true },
    });
    const family = terms.filter((term) => familyMeta(term) !== null);
    expect(family.length).toBeGreaterThan(15);
    for (const term of family) {
      const meta = familyMeta(term)!;
      expect(meta.role, `no role on ${term.slug}`).not.toBeNull();
      expect(Number.isInteger(meta.generation), `bad generation on ${term.slug}`).toBe(true);
    }
  });

  it("leaves non-family terms alone", async () => {
    const coworker = await prisma.taxonomyTerm.findFirst({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "coworker" },
    });
    expect(familyMeta(coworker)).toBeNull();
  });

  it("pairs every family term with a reciprocal whose generation mirrors it", async () => {
    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, slug: true, metadata: true, inverseTermId: true },
    });
    const byId = new Map(terms.map((t) => [t.id, t]));

    for (const term of terms) {
      const meta = familyMeta(term);
      if (!meta) continue;
      expect(term.inverseTermId, `no inverse wired for ${term.slug}`).not.toBeNull();
      const inverse = byId.get(term.inverseTermId!);
      const inverseMeta = familyMeta(inverse);
      expect(inverseMeta, `inverse of ${term.slug} is not a family term`).not.toBeNull();
      // "B is A's parent" (+1) must invert to "A is B's child" (-1). Summed
      // rather than negated, so a symmetric term's 0 doesn't trip over -0.
      expect(meta.generation + inverseMeta!.generation, `generation mismatch on ${term.slug}`).toBe(0);
      // Reciprocals must round-trip, or one direction of a link goes missing.
      expect(inverse!.inverseTermId, `${term.slug} inverse does not round-trip`).toBe(term.id);
    }
  });

  it("upgrades an account that predates the family terms", async () => {
    // What an existing install looks like: none of the new terms, and no
    // metadata on the old ones. runStartupTasks calls provisionTaxonomies on
    // every boot, so this is the path a real upgrade takes.
    await prisma.taxonomyTerm.deleteMany({
      where: {
        ownerId,
        kind: "RELATIONSHIP_TYPE",
        slug: { notIn: ["partner", "spouse", "parent", "child", "sibling", "friend"] },
      },
    });
    await prisma.$executeRawUnsafe(
      "UPDATE `TaxonomyTerm` SET metadata = NULL, inverseTermId = NULL WHERE ownerId = ? AND kind = 'RELATIONSHIP_TYPE'",
      ownerId,
    );

    await prisma.$transaction((tx) => provisionTaxonomies(tx, ownerId));

    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { slug: true, metadata: true, inverseTermId: true },
    });
    const bySlug = new Map(terms.map((t) => [t.slug, t]));

    // The new terms arrive...
    expect(familyMeta(bySlug.get("cousin"))?.tier).toBe("extended");
    expect(familyMeta(bySlug.get("ex-spouse"))?.tier).toBe("former");
    // ...the pre-existing ones gain their metadata...
    expect(familyMeta(bySlug.get("parent"))?.role).toBe("parent");
    // ...and every family term is wired to its reciprocal again.
    for (const term of terms) {
      if (!familyMeta(term)) continue;
      expect(term.inverseTermId, `no inverse for ${term.slug}`).not.toBeNull();
    }
  });

  it("backfills metadata onto terms seeded before it existed", async () => {
    await prisma.taxonomyTerm.updateMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "parent" },
      data: { metadata: Prisma.DbNull },
    });
    expect(
      familyMeta(
        await prisma.taxonomyTerm.findFirst({
          where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "parent" },
        }),
      ),
    ).toBeNull();

    await prisma.$transaction((tx) => refreshSystemTermMetadata(tx, ownerId));

    const refreshed = await prisma.taxonomyTerm.findFirst({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "parent" },
    });
    expect(familyMeta(refreshed)?.role).toBe("parent");
  });

  it("does not overwrite metadata the user has already set", async () => {
    await prisma.taxonomyTerm.updateMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "cousin" },
      data: { metadata: { family: true, tier: "immediate", generation: 0, role: "cousin" } },
    });

    await prisma.$transaction((tx) => refreshSystemTermMetadata(tx, ownerId));

    const term = await prisma.taxonomyTerm.findFirst({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "cousin" },
    });
    // The user moved cousins into "immediate"; the refresh must respect that.
    expect(familyMeta(term)?.tier).toBe("immediate");
  });

  it("does not touch terms the user created themselves", async () => {
    // Slugs are unique per owner and kind, so a custom term always has a slug
    // no seed uses — which is exactly why it must be left alone.
    const custom = await prisma.taxonomyTerm.create({
      data: {
        ownerId,
        kind: "RELATIONSHIP_TYPE",
        slug: "fishing-buddy",
        label: "Fishing buddy",
        isSystem: false,
      },
    });

    await prisma.$transaction((tx) => refreshSystemTermMetadata(tx, ownerId));

    const after = await prisma.taxonomyTerm.findUniqueOrThrow({ where: { id: custom.id } });
    expect(familyMeta(after)).toBeNull();
  });

  it("does not reach another owner's terms", async () => {
    const other = await createTestUser();
    await prisma.taxonomyTerm.updateMany({
      where: { ownerId: other.id, kind: "RELATIONSHIP_TYPE", slug: "parent" },
      data: { metadata: Prisma.DbNull },
    });

    await prisma.$transaction((tx) => refreshSystemTermMetadata(tx, ownerId));

    const theirs = await prisma.taxonomyTerm.findFirst({
      where: { ownerId: other.id, kind: "RELATIONSHIP_TYPE", slug: "parent" },
    });
    expect(familyMeta(theirs)).toBeNull();
  });
});

describe.skipIf(!hasTestDatabase)("households", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  async function contact(firstName: string) {
    return prisma.contact.create({ data: { ownerId, firstName } });
  }

  it("keeps members when the household is deleted", async () => {
    const mum = await contact("Mum");
    const dad = await contact("Dad");
    const household = await prisma.household.create({
      data: {
        ownerId,
        name: "Mum and Dad's",
        members: { create: [{ contactId: mum.id }, { contactId: dad.id }] },
      },
    });

    await prisma.household.delete({ where: { id: household.id } });

    expect(await prisma.contact.count({ where: { ownerId } })).toBe(2);
    expect(await prisma.householdMember.count()).toBe(0);
  });

  it("drops the membership when a member is deleted", async () => {
    const mum = await contact("Mum");
    const household = await prisma.household.create({
      data: { ownerId, name: "Home", members: { create: [{ contactId: mum.id }] } },
    });

    await prisma.contact.delete({ where: { id: mum.id } });

    expect(await prisma.householdMember.count({ where: { householdId: household.id } })).toBe(0);
    expect(await prisma.household.count({ where: { id: household.id } })).toBe(1);
  });

  it("rejects two households with the same name for one owner", async () => {
    await prisma.household.create({ data: { ownerId, name: "The Whitfields" } });
    await expect(
      prisma.household.create({ data: { ownerId, name: "The Whitfields" } }),
    ).rejects.toThrow();
  });

  it("allows the same household name for a different owner", async () => {
    const other = await createTestUser();
    await prisma.household.create({ data: { ownerId, name: "The Whitfields" } });
    await expect(
      prisma.household.create({ data: { ownerId: other.id, name: "The Whitfields" } }),
    ).resolves.toBeTruthy();
  });
});

describe.skipIf(!hasTestDatabase)("family relationships", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  it("stores both directions with matching generations", async () => {
    const me = await prisma.contact.create({ data: { ownerId, firstName: "Me" } });
    const mum = await prisma.contact.create({ data: { ownerId, firstName: "Mum" } });
    const parent = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug: "parent" },
    });

    const pairId = randomBytes(8).toString("hex");
    await prisma.relationship.createMany({
      data: [
        { ownerId, fromContactId: me.id, toContactId: mum.id, typeId: parent.id, pairId },
        {
          ownerId,
          fromContactId: mum.id,
          toContactId: me.id,
          typeId: parent.inverseTermId!,
          pairId,
        },
      ],
    });

    const rows = await prisma.relationship.findMany({
      where: { ownerId, pairId },
      include: { type: true },
    });
    expect(rows).toHaveLength(2);
    const generations = rows.map((row) => familyMeta(row.type)!.generation).sort();
    expect(generations).toEqual([-1, 1]);
  });

  it("every endable role has a seeded 'former' term to become", async () => {
    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { slug: true, metadata: true },
    });
    const roles = new Set(
      terms.map((term) => familyMeta(term)?.role).filter((role): role is NonNullable<typeof role> =>
        Boolean(role),
      ),
    );

    for (const role of roles) {
      const ended = endedRole(role);
      if (!ended) continue;
      expect(roles.has(ended), `no term for ${role} → ${ended}`).toBe(true);
      expect(isEndedRole(ended)).toBe(true);
      // A former relationship must not itself be endable, or the UI would
      // offer to end a divorce.
      expect(endedRole(ended), `${ended} should not be endable`).toBeNull();
    }
  });

  it("former terms sit in the former tier and mirror their generation", async () => {
    const terms = await prisma.taxonomyTerm.findMany({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { slug: true, metadata: true },
    });
    const former = terms.filter((term) => isEndedRole(familyMeta(term)?.role));
    expect(former.length).toBeGreaterThanOrEqual(7);
    for (const term of former) {
      expect(familyMeta(term)!.tier, `wrong tier on ${term.slug}`).toBe("former");
    }
  });

  it("dismissals are one row per unordered pair", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "A" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "B" } });
    const [first, second] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];

    await prisma.familySuggestionDismissal.create({
      data: { ownerId, aContactId: first, bContactId: second },
    });
    await expect(
      prisma.familySuggestionDismissal.create({
        data: { ownerId, aContactId: first, bContactId: second },
      }),
    ).rejects.toThrow();

    await prisma.contact.delete({ where: { id: a.id } });
    expect(await prisma.familySuggestionDismissal.count({ where: { ownerId } })).toBe(0);
  });
});

describe.skipIf(!hasTestDatabase)("ending a relationship", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  async function term(slug: string) {
    return prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug },
    });
  }

  /** Records a relationship both ways, as the app does. */
  async function linkPair(fromId: string, toId: string, slug: string): Promise<string> {
    const type = await term(slug);
    const pairId = randomBytes(8).toString("hex");
    await prisma.relationship.createMany({
      data: [
        { ownerId, fromContactId: fromId, toContactId: toId, typeId: type.id, pairId },
        {
          ownerId,
          fromContactId: toId,
          toContactId: fromId,
          typeId: type.inverseTermId ?? type.id,
          pairId,
        },
      ],
    });
    return pairId;
  }

  async function slugsFor(pairId: string): Promise<string[]> {
    const rows = await prisma.relationship.findMany({
      where: { ownerId, pairId },
      include: { type: { select: { slug: true } } },
    });
    return rows.map((row) => row.type.slug).sort();
  }

  it("re-types both halves of a marriage without deleting anyone", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    const pairId = await linkPair(a.id, b.id, "spouse");

    const result = await prisma.$transaction((tx) =>
      endFamilyPair(tx, ownerId, pairId, "Divorced 2021, still co-parenting."),
    );

    expect(result).toEqual({ ok: true, changed: 2 });
    expect(await slugsFor(pairId)).toEqual(["ex-spouse", "ex-spouse"]);
    // The people, and the link itself, survive — that is the entire point.
    expect(await prisma.contact.count({ where: { ownerId } })).toBe(2);
    const rows = await prisma.relationship.findMany({ where: { ownerId, pairId } });
    expect(rows.every((row) => row.notes === "Divorced 2021, still co-parenting.")).toBe(true);
  });

  it("mirrors asymmetric in-law roles", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const rose = await prisma.contact.create({ data: { ownerId, firstName: "Rose" } });
    // Rose is Ana's parent-in-law; the reciprocal is child-in-law.
    const pairId = await linkPair(a.id, rose.id, "parent-in-law");

    await prisma.$transaction((tx) => endFamilyPair(tx, ownerId, pairId));

    expect(await slugsFor(pairId)).toEqual(["ex-child-in-law", "ex-parent-in-law"]);
  });

  it("refuses to end a blood relationship", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    const pairId = await linkPair(a.id, b.id, "sibling");

    const result = await prisma.$transaction((tx) => endFamilyPair(tx, ownerId, pairId));

    expect(result).toEqual({ ok: false, reason: "cannot-end" });
    expect(await slugsFor(pairId)).toEqual(["sibling", "sibling"]);
  });

  it("collapses onto an ex link that was already recorded separately", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    await linkPair(a.id, b.id, "ex-spouse");
    const marriage = await linkPair(a.id, b.id, "spouse");

    // Re-typing onto a type the pair already has would break the uniqueness
    // constraint, so the duplicate half is removed instead of erroring.
    const result = await prisma.$transaction((tx) =>
      endFamilyPair(tx, ownerId, marriage, "Remarried and divorced again."),
    );

    expect(result.ok).toBe(true);
    expect(await prisma.relationship.findMany({ where: { ownerId, pairId: marriage } })).toEqual(
      [],
    );
    const remaining = await prisma.relationship.findMany({
      where: { ownerId },
      include: { type: { select: { slug: true } } },
    });
    expect(remaining.map((row) => row.type.slug)).toEqual(["ex-spouse", "ex-spouse"]);
    expect(remaining.every((row) => row.notes === "Remarried and divorced again.")).toBe(true);
  });

  it("leaves an already-ended relationship alone", async () => {
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    const pairId = await linkPair(a.id, b.id, "ex-spouse");

    const result = await prisma.$transaction((tx) => endFamilyPair(tx, ownerId, pairId));

    expect(result).toEqual({ ok: false, reason: "cannot-end" });
    expect(await slugsFor(pairId)).toEqual(["ex-spouse", "ex-spouse"]);
  });

  it("does not touch another owner's pair", async () => {
    const other = await createTestUser();
    const a = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const b = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    const pairId = await linkPair(a.id, b.id, "spouse");

    const result = await prisma.$transaction((tx) => endFamilyPair(tx, other.id, pairId));

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await slugsFor(pairId)).toEqual(["spouse", "spouse"]);
  });

  it("keeps a new marriage alongside the old one", async () => {
    const me = await prisma.contact.create({ data: { ownerId, firstName: "Ana" } });
    const ex = await prisma.contact.create({ data: { ownerId, firstName: "Ben" } });
    const now = await prisma.contact.create({ data: { ownerId, firstName: "Kit" } });

    const old = await linkPair(me.id, ex.id, "spouse");
    await prisma.$transaction((tx) => endFamilyPair(tx, ownerId, old));
    await linkPair(me.id, now.id, "spouse");

    const mine = await prisma.relationship.findMany({
      where: { ownerId, fromContactId: me.id },
      include: { type: { select: { slug: true } } },
    });
    expect(mine.map((row) => row.type.slug).sort()).toEqual(["ex-spouse", "spouse"]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
