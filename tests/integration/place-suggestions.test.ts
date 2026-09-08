import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: true,
  unlocked: false,
}));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    timezone: "America/New_York",
    prefs: {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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

const { PLACE_SUGGESTIONS_CAP, listLocationOptions, listPlaceSuggestions } =
  await import("@/server/queries/locations");
const { normalizeLocationName } = await import("@/server/services/locations");

const TZ = "America/New_York";

/**
 * The picker feed is a third route to an interaction, after the directory and
 * the place page — and the one that renders on nearly every screen. What is
 * unproven without these is that it applies the same predicate, that the count
 * it shows is the filtered one, and that its order does not move when the lock
 * opens.
 */
describe.skipIf(!hasTestDatabase)("place suggestions", () => {
  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
  });

  afterAll(() => prisma.$disconnect());

  async function place(name: string, extra: Record<string, unknown> = {}) {
    return prisma.location.create({
      data: {
        ownerId: state.ownerId,
        name,
        normalizedName: normalizeLocationName(name),
        ...extra,
      },
    });
  }

  async function visit(
    locationId: string,
    contactIds: string[],
    options: { isPrivate?: boolean; occurredAt?: Date } = {},
  ) {
    return prisma.interaction.create({
      data: {
        ownerId: state.ownerId,
        occurredAt: options.occurredAt ?? new Date(),
        locationId,
        isPrivate: options.isPrivate ?? false,
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
      },
    });
  }

  it("withholds a place reachable only through a hidden visit, and its count", async () => {
    const [ada, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Ada" } }),
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      }),
    ]);
    const cafe = await place("Corner Cafe");
    const hideaway = await place("The Hideaway");

    await visit(cafe.id, [ada.id]);
    await visit(cafe.id, [ada.id], { isPrivate: true });
    // Never marked private, but a private person was there.
    await visit(cafe.id, [secret.id]);
    // This place exists only through a withheld visit.
    await visit(hideaway.id, [secret.id]);

    const locked = await listPlaceSuggestions(state.ownerId, TZ);
    expect(locked.items.map((row) => row.name)).toEqual(["Corner Cafe"]);
    // The number under the name is the filtered one. A count that shifts on
    // unlock is itself the disclosure.
    expect(locked.items[0].subtitle).toMatch(/^visited once/);

    state.unlocked = true;
    const unlocked = await listPlaceSuggestions(state.ownerId, TZ);
    expect(unlocked.items.map((row) => row.name)).toEqual([
      "Corner Cafe",
      "The Hideaway",
    ]);
    expect(unlocked.items[0].subtitle).toMatch(/^visited 3 times/);
  });

  it("orders by name, not by recency, in either lock state", async () => {
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const zebra = await place("Zebra Bar");
    const apple = await place("Apple Diner");

    // The most recent visit is to the alphabetically last place. If the order
    // were derived from recency it would put Zebra first — and would then
    // reshuffle the moment the lock opened, which is the leak.
    await visit(apple.id, [ada.id], { occurredAt: new Date("2026-01-05T12:00:00Z") });
    await visit(zebra.id, [ada.id], { occurredAt: new Date("2026-05-15T12:00:00Z") });

    const locked = await listPlaceSuggestions(state.ownerId, TZ);
    expect(locked.items.map((row) => row.name)).toEqual(["Apple Diner", "Zebra Bar"]);

    state.unlocked = true;
    const unlocked = await listPlaceSuggestions(state.ownerId, TZ);
    expect(unlocked.items.map((row) => row.name)).toEqual(["Apple Diner", "Zebra Bar"]);
  });

  it("dates the last visit in the account's timezone", async () => {
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const cafe = await place("Corner Cafe");
    await visit(cafe.id, [ada.id], { occurredAt: new Date("2026-05-15T12:00:00Z") });
    await visit(cafe.id, [ada.id], { occurredAt: new Date("2026-01-05T12:00:00Z") });

    const { items } = await listPlaceSuggestions(state.ownerId, TZ);
    expect(items[0].subtitle).toBe("visited 2 times · last May 2026");

    // An instant that is still 31 December in New York must not be read as
    // January by the server's own clock.
    const newYear = await place("New Year Bar");
    await visit(newYear.id, [ada.id], { occurredAt: new Date("2027-01-01T02:00:00Z") });
    const again = await listPlaceSuggestions(state.ownerId, TZ);
    expect(again.items.find((row) => row.name === "New Year Bar")?.subtitle).toBe(
      "visited once · last December 2026",
    );
  });

  it("says nothing about visits for a place that has only ever been planned", async () => {
    const cafe = await place("Corner Cafe");
    await prisma.plan.create({
      data: { ownerId: state.ownerId, title: "Try it", locationId: cafe.id },
    });

    const { items } = await listPlaceSuggestions(state.ownerId, TZ);
    expect(items.map((row) => row.name)).toEqual(["Corner Cafe"]);
    expect(items[0].subtitle).toBeNull();
  });

  it("reports truncation rather than silently dropping the overflow", async () => {
    const total = PLACE_SUGGESTIONS_CAP + 1;
    const names = Array.from(
      { length: total },
      (_, index) => `Place ${String(index).padStart(4, "0")}`,
    );
    await prisma.location.createMany({
      data: names.map((name) => ({
        ownerId: state.ownerId,
        name,
        normalizedName: normalizeLocationName(name),
      })),
    });
    const rows = await prisma.location.findMany({
      where: { ownerId: state.ownerId },
      select: { id: true },
    });
    await prisma.interaction.createMany({
      data: rows.map((row) => ({
        ownerId: state.ownerId,
        occurredAt: new Date(),
        locationId: row.id,
      })),
    });
    const capped = await listPlaceSuggestions(state.ownerId, TZ);
    expect(capped.items).toHaveLength(PLACE_SUGGESTIONS_CAP);
    expect(capped.truncated).toBe(true);

    // The parser's vocabulary is deliberately not capped alongside it: past a
    // cap a known venue stops being recognised and part of its name gets
    // offered as a person instead.
    expect(await listLocationOptions(state.ownerId)).toHaveLength(total);
  });

  it("hands the client strings, never Decimal or BigInt", async () => {
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const cafe = await place("Corner Cafe", {
      address: "120 Maple Street",
      city: "Arlington",
      region: "VA",
      country: "US",
      latitude: "38.8800000",
      longitude: "-77.0900000",
      osmType: "N",
      osmId: BigInt("123456789012"),
    });
    await visit(cafe.id, [ada.id]);

    const { items } = await listPlaceSuggestions(state.ownerId, TZ);
    const [row] = items;
    // These cross into a client component. A Decimal or a BigInt throws at
    // render, and the address form fills its coordinates from them.
    expect(typeof row.latitude).toBe("string");
    expect(typeof row.longitude).toBe("string");
    expect(row.osmId).toBe("123456789012");
    expect(row.address).toBe("120 Maple Street");
    expect(row.region).toBe("VA");
    expect(JSON.stringify(row)).toContain("123456789012");
  });
});
