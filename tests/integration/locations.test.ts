import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", enabled: true, unlocked: false }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    expiresAt: null,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: false }) as const,
}));

const { getLocation, listContactLocations, listLocationOptions, listLocations } = await import(
  "@/server/queries/locations"
);
const { normalizeLocationName, resolveLocation } = await import(
  "@/server/services/locations"
);
const { buildTimeline } = await import("@/server/queries/timeline");

const TZ = "America/New_York";

/**
 * A place is a second route to an interaction, and so a second way to leak
 * one. These call the location queries themselves rather than rebuilding their
 * where-clauses: the shared predicate is already covered by `privacy.test.ts`,
 * and what is unproven here is that these queries apply it — to the nested
 * reads and to the aggregates the place page displays.
 */
describe.skipIf(!hasTestDatabase)("location history", () => {
  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
  });

  afterAll(() => prisma.$disconnect());

  async function place(ownerId: string, name: string) {
    return prisma.location.create({
      data: { ownerId, name, normalizedName: normalizeLocationName(name) },
    });
  }

  async function visit(
    locationId: string,
    contactIds: string[],
    options: { isPrivate?: boolean; label?: string } = {},
  ) {
    return prisma.interaction.create({
      data: {
        ownerId: state.ownerId,
        occurredAt: new Date(),
        locationId,
        location: options.label ?? "Corner Cafe",
        isPrivate: options.isPrivate ?? false,
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
      },
    });
  }

  it("withholds private visits and visits with a private participant, counts included", async () => {
    const [ada, grace, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Ada" } }),
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Grace" } }),
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      }),
    ]);
    const cafe = await place(state.ownerId, "Corner Cafe");

    await visit(cafe.id, [ada.id, grace.id], { label: " Corner   Cafe " });
    await visit(cafe.id, [ada.id]);
    // Withheld because it is marked private.
    await visit(cafe.id, [ada.id], { isPrivate: true });
    // Withheld because a private person was there, though it was never marked.
    // Aggregating by place must not be the thing that discloses them.
    await visit(cafe.id, [secret.id]);

    const [listed] = await listLocations(state.ownerId);
    expect(listed.visitCount).toBe(2);
    // A count that shifts on unlock is itself a disclosure, so the aggregates
    // have to be filtered too, not just the rows behind them.
    expect(listed.peopleCount).toBe(2);

    const detail = await getLocation(state.ownerId, cafe.id);
    expect(detail?.interactions).toHaveLength(2);
    const seen = new Set(
      detail?.interactions.flatMap((row) => row.participants.map((p) => p.contact.id)),
    );
    expect(seen).toEqual(new Set([ada.id, grace.id]));
    expect(seen.has(secret.id)).toBe(false);

    // The private contact's own history is withheld by the same route.
    expect(await listContactLocations(state.ownerId, secret.id)).toEqual([]);

    state.unlocked = true;
    const [unlocked] = await listLocations(state.ownerId);
    expect(unlocked.visitCount).toBe(4);
    expect(unlocked.peopleCount).toBe(3);
    expect((await getLocation(state.ownerId, cafe.id))?.interactions).toHaveLength(4);
    expect(await listContactLocations(state.ownerId, secret.id)).toHaveLength(1);
  });

  it("hides a place entirely when every visit to it is withheld", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [secret.id]);

    // Listing the place with a visit count of zero would announce that
    // somewhere was visited by someone who cannot be shown.
    expect(await listLocations(state.ownerId)).toEqual([]);
    expect(await getLocation(state.ownerId, cafe.id)).toBeNull();
  });

  it("keeps the entered label rather than rewriting it to the canonical name", async () => {
    state.unlocked = true;
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [], { label: " Corner   Cafe " });

    const detail = await getLocation(state.ownerId, cafe.id);
    expect(detail?.name).toBe("Corner Cafe");
    expect(detail?.interactions[0]?.location).toBe(" Corner   Cafe ");
  });

  it("does not offer quick add a place known only through a hidden visit", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const hidden = await place(state.ownerId, "Quiet Bar");
    const open = await place(state.ownerId, "Corner Cafe");
    await visit(hidden.id, [secret.id], { label: "Quiet Bar" });
    await visit(open.id, [ada.id]);

    // Which places you have been is itself a disclosure, so the parser is fed
    // the same filtered set the Places directory shows.
    const locked = await listLocationOptions(state.ownerId);
    expect(locked.map((row) => row.name)).toEqual(["Corner Cafe"]);

    state.unlocked = true;
    const unlocked = await listLocationOptions(state.ownerId);
    expect(unlocked.map((row) => row.name).sort()).toEqual(["Corner Cafe", "Quiet Bar"]);
  });

  it("still resolves a hidden place by name rather than duplicating it", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const hidden = await place(state.ownerId, "Quiet Bar");
    await visit(hidden.id, [secret.id], { label: "Quiet Bar" });

    // Locked, the parser cannot name it back at you — but typing it yourself
    // must still land on the row that exists, not create a second one.
    expect(await listLocationOptions(state.ownerId)).toEqual([]);
    const resolved = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "quiet bar"),
    );
    expect(resolved?.id).toBe(hidden.id);
    expect(await prisma.location.count({ where: { ownerId: state.ownerId } })).toBe(1);
  });

  it("filters the timeline on the place, not just the label that was typed", async () => {
    state.unlocked = true;
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [], { label: "Corner Cafe" });
    // The label is kept exactly as typed while the place collapses whitespace,
    // so a filter that only compared the label dropped this one even though
    // the query had already admitted it on `normalizedName`.
    await visit(cafe.id, [], { label: " Corner   Cafe " });

    const byName = await buildTimeline(state.ownerId, TZ, { location: "Corner Cafe" });
    expect(byName).toHaveLength(2);

    // Case folding has to agree with the normalizer the rows were written with.
    expect(await buildTimeline(state.ownerId, TZ, { location: "corner cafe" })).toHaveLength(2);

    // The id filter never compares strings at all.
    expect(await buildTimeline(state.ownerId, TZ, { locationId: cafe.id })).toHaveLength(2);
  });

  it("keeps the place filter from admitting entries that have no place", async () => {
    state.unlocked = true;
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [ada.id]);
    await prisma.gift.create({
      data: {
        ownerId: state.ownerId,
        contactId: ada.id,
        name: "A book",
        status: "GIVEN",
        occurredOn: new Date(),
      },
    });

    // A gift carries no location; filtering by a place must not sweep it in.
    const filtered = await buildTimeline(state.ownerId, TZ, { locationId: cafe.id });
    expect(filtered.every((entry) => entry.kind === "interaction")).toBe(true);
    expect(filtered).toHaveLength(1);
  });

  it("resolves the same name to one place per owner, never across owners", async () => {
    const stranger = await createTestUser();

    const mine = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "  Corner   Cafe "),
    );
    const mineAgain = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "corner cafe"),
    );
    const theirs = await prisma.$transaction((tx) =>
      resolveLocation(tx, stranger.id, "Corner Cafe"),
    );

    // Case and repeated whitespace are the same place...
    expect(mineAgain?.id).toBe(mine?.id);
    // ...but the same spelling in another account is not, and resolution must
    // scope by owner rather than trusting the normalized name to be unique.
    expect(theirs?.id).not.toBe(mine?.id);
    expect(await prisma.location.count({ where: { ownerId: state.ownerId } })).toBe(1);
    expect(await prisma.location.count({ where: { ownerId: stranger.id } })).toBe(1);
  });
});
