import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * `getFamilyOverview` — what `/family` actually renders.
 *
 * The banding arithmetic is unit-tested in `tests/unit/family-generations.test.ts`;
 * what needs a database is everything around it: that the privacy lock reaches
 * the tree and the household list, that the anchor falls back to a real person,
 * and that the suggestion order is stable enough to cap. The page draws a
 * bounded window over the suggestions, so an unstable order does not merely
 * look untidy — it changes which ones a reader can reach at all.
 */
vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

const privacy = { enabled: false, unlocked: true };

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => privacy,
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { getFamilyOverview } = await import("@/server/queries/family");

describe.skipIf(!hasTestDatabase)("family overview", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    ownerId = (await createTestUser()).id;
    privacy.enabled = false;
    privacy.unlocked = true;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(firstName: string, isPrivate = false) {
    return prisma.contact.create({ data: { ownerId, firstName, isPrivate } });
  }

  /** Records both halves of a link, the way every write path in the app does. */
  async function link(fromId: string, toId: string, slug: string) {
    const type = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "RELATIONSHIP_TYPE", slug },
    });
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
  }

  function bandOf(
    overview: Awaited<ReturnType<typeof getFamilyOverview>>,
    contactId: string,
  ): number | undefined {
    return overview.bands.find((band) => band.people.some((p) => p.person.id === contactId))
      ?.generation;
  }

  it("bands a recorded family around the person it was asked to anchor on", async () => {
    const me = await person("Me");
    const mum = await person("Mum");
    const gran = await person("Gran");
    const kid = await person("Kid");
    await link(me.id, mum.id, "parent");
    await link(mum.id, gran.id, "parent");
    await link(kid.id, me.id, "parent");

    const overview = await getFamilyOverview(ownerId, me.id);

    expect(overview.anchor?.id).toBe(me.id);
    expect(bandOf(overview, mum.id)).toBe(1);
    expect(bandOf(overview, gran.id)).toBe(2);
    expect(bandOf(overview, kid.id)).toBe(-1);
    // Bands come back eldest first, so the page reads top-down like a tree.
    expect(overview.bands.map((band) => band.generation)).toEqual([2, 1, 0, -1]);
  });

  it("falls back to the best-connected person when the anchor is not in the family", async () => {
    const me = await person("Me");
    const mum = await person("Mum");
    const gran = await person("Gran");
    const stranger = await person("Stranger");
    await link(me.id, mum.id, "parent");
    await link(mum.id, gran.id, "parent");

    const overview = await getFamilyOverview(ownerId, stranger.id);

    // Mum has two links of her own — up to Gran and down to Me — where Me and
    // Gran have one each. Anchoring on someone outside the family would put
    // every person in a band of their own and say nothing.
    expect(overview.anchor?.id).toBe(mum.id);
    expect(bandOf(overview, me.id)).toBe(-1);
    expect(bandOf(overview, gran.id)).toBe(1);
  });

  it("phrases the links from the anchor's point of view, not each person's", async () => {
    const me = await person("Me");
    const mum = await person("Mum");
    const gran = await person("Gran");
    await link(me.id, mum.id, "parent");
    await link(mum.id, gran.id, "parent");

    const overview = await getFamilyOverview(ownerId, me.id);
    const entry = overview.bands
      .flatMap((band) => band.people)
      .find((p) => p.person.id === mum.id);

    expect(entry?.links.map((l) => l.term.label)).toEqual(["Parent"]);
    // Gran is Mum's parent, not the anchor's — so the anchor sees no direct
    // link, only a band. Repeating every edge would make the tree unreadable.
    const granEntry = overview.bands
      .flatMap((band) => band.people)
      .find((p) => p.person.id === gran.id);
    expect(granEntry?.links).toEqual([]);
  });

  it("keeps a private relative out of the tree while the lock is closed", async () => {
    const me = await person("Me");
    const mum = await person("Mum");
    const secret = await person("Secret", true);
    await link(me.id, mum.id, "parent");
    await link(me.id, secret.id, "sibling");

    privacy.enabled = true;
    privacy.unlocked = false;
    const locked = await getFamilyOverview(ownerId, me.id);

    const ids = locked.bands.flatMap((band) => band.people.map((p) => p.person.id));
    expect(ids).toContain(mum.id);
    expect(ids).not.toContain(secret.id);
    // Nor through anyone else's link list — a name is a name wherever it is
    // printed.
    const links = locked.bands.flatMap((band) =>
      band.people.flatMap((p) => p.links.map((l) => l.person.id)),
    );
    expect(links).not.toContain(secret.id);

    privacy.unlocked = true;
    const unlocked = await getFamilyOverview(ownerId, me.id);
    expect(unlocked.bands.flatMap((band) => band.people.map((p) => p.person.id))).toContain(
      secret.id,
    );
  });

  it("withholds a household that a private member could be identified through", async () => {
    const me = await person("Me");
    const secret = await person("Secret", true);
    await prisma.household.create({
      data: { ownerId, name: "Ours", members: { create: [{ contactId: me.id }] } },
    });
    await prisma.household.create({
      data: {
        ownerId,
        name: "Theirs",
        members: { create: [{ contactId: me.id }, { contactId: secret.id }] },
      },
    });

    privacy.enabled = true;
    privacy.unlocked = false;
    const locked = await getFamilyOverview(ownerId);

    expect(locked.households.map((h) => h.name)).toEqual(["Ours"]);

    privacy.unlocked = true;
    const unlocked = await getFamilyOverview(ownerId);
    expect(unlocked.households.map((h) => h.name)).toEqual(["Ours", "Theirs"]);
  });

  it("returns suggestions in a stable order, because the page caps them", async () => {
    // One grandparent link and three grandchildren: whichever way the rows
    // come back, the cards must sort the same way, or capping the list would
    // hide a different suggestion on every render.
    const gran = await person("Gran");
    const mum = await person("Mum");
    await link(mum.id, gran.id, "parent");
    for (const name of ["Zoe", "Ada", "Kit"]) {
      const kid = await person(name);
      await link(kid.id, mum.id, "parent");
    }

    const first = await getFamilyOverview(ownerId, gran.id);
    const second = await getFamilyOverview(ownerId, gran.id);
    const key = (o: typeof first) => o.suggestions.map((s) => `${s.subjectId}:${s.personId}`);

    expect(key(first)).toEqual(key(second));
    expect(first.suggestions.length).toBeGreaterThan(0);
    const names = first.suggestions.map((s) => `${s.subject.firstName}|${s.person.firstName}`);
    expect([...names].sort()).toEqual(names);
  });

  it("never suggests a pair the viewer cannot see both ends of", async () => {
    const gran = await person("Gran");
    const mum = await person("Mum");
    const secret = await person("Secret", true);
    await link(mum.id, gran.id, "parent");
    await link(secret.id, mum.id, "parent");

    privacy.enabled = true;
    privacy.unlocked = false;
    const locked = await getFamilyOverview(ownerId, gran.id);

    const touched = locked.suggestions.flatMap((s) => [s.subjectId, s.personId]);
    expect(touched).not.toContain(secret.id);
  });

  it("has nothing to anchor on when no family is recorded", async () => {
    await person("Alone");

    const overview = await getFamilyOverview(ownerId);

    expect(overview.anchor).toBeNull();
    expect(overview.bands).toEqual([]);
    expect(overview.suggestions).toEqual([]);
  });
});
