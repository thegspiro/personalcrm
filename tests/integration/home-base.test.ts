import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The home base, and the origins every distance is measured from.
 *
 * Worth an integration suite rather than a unit test because the two things
 * most likely to be got wrong here are both database-shaped: that a coordinate
 * survives the `DECIMAL(10,7)` round trip intact, and that a private contact's
 * address does not become an origin while the lock is closed — a point on a map
 * that appears only when unlocked is itself a disclosure.
 */

const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

const TZ = "America/New_York";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: TZ }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: state.enabled,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
  requireUnlocked: async () =>
    state.enabled && !state.unlocked ? { ok: false, error: "Unlock to continue." } : { ok: true },
}));

const { updateHomeBase } = await import("@/server/actions/settings");
const { originsFor } = await import("@/server/queries/origins");

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe.skipIf(!hasTestDatabase)("home base and origins", () => {
  let ownerId: string;
  let danaId: string;
  let privateId: string;

  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    ownerId = owner.id;
    state.ownerId = ownerId;
    state.enabled = false;
    state.unlocked = true;

    await prisma.userPreference.create({ data: { userId: ownerId } });

    const [dana, hidden] = await Promise.all([
      prisma.contact.create({ data: { ownerId, firstName: "Dana" } }),
      prisma.contact.create({ data: { ownerId, firstName: "Robin", isPrivate: true } }),
    ]);
    danaId = dana.id;
    privateId = hidden.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults to miles and no home at all", async () => {
    // What every installation looks like the moment it upgrades: nothing set,
    // so nothing anywhere shows a distance.
    const origins = await originsFor(ownerId);
    expect(origins).toMatchObject({ home: null, contact: null, unit: "mi" });
  });

  it("stores a home base and reads it back as a usable point", async () => {
    const result = await updateHomeBase(
      form({
        homeAddress: "14 Ashfield Road",
        homeCity: "Leeds",
        homeRegion: "West Yorkshire",
        homeCountry: "United Kingdom",
        homeLatitude: "53.8008",
        homeLongitude: "-1.5491",
        distanceUnit: "km",
      }),
    );
    expect(result.ok).toBe(true);

    const origins = await originsFor(ownerId);
    expect(origins.unit).toBe("km");
    // DECIMAL(10,7) keeps seven places, which is roughly a centimetre — the
    // round trip must not quietly truncate to the whole degree.
    expect(origins.home?.lat).toBeCloseTo(53.8008, 4);
    expect(origins.home?.lon).toBeCloseTo(-1.5491, 4);
  });

  it("refuses half a pair and an unknown unit", async () => {
    const half = await updateHomeBase(form({ homeCity: "Leeds", homeLatitude: "53.8008" }));
    expect(half.ok).toBe(false);
    expect((half as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty(
      "homeLongitude",
    );

    expect((await updateHomeBase(form({ distanceUnit: "furlongs" }))).ok).toBe(false);
    expect((await originsFor(ownerId)).home).toBeNull();

    for (const bad of [
      { homeLatitude: "91", homeLongitude: "0" },
      { homeLatitude: "0", homeLongitude: "181" },
    ]) {
      expect((await updateHomeBase(form(bad))).ok).toBe(false);
    }
  });

  it("keeps the unit when a form does not carry it", async () => {
    // Presence, not value — the rule `updateDefaults` follows. A panel that
    // happens not to include the field must not silently reset it.
    await updateHomeBase(form({ homeCity: "Leeds", distanceUnit: "km" }));
    await updateHomeBase(form({ homeCity: "York" }));

    const prefs = await prisma.userPreference.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(prefs.distanceUnit).toBe("km");
    expect(prefs.homeCity).toBe("York");
  });

  it("takes a contact's placed address as the second origin", async () => {
    await prisma.address.createMany({
      data: [
        // Unplaced, and first in the render order — it must not win just by
        // being first, or "near her" measures from nowhere.
        { contactId: danaId, label: "A office" },
        { contactId: danaId, label: "B home", latitude: 53.8008, longitude: -1.5491 },
      ],
    });

    const origins = await originsFor(ownerId, danaId);
    expect(origins.contact?.lat).toBeCloseTo(53.8008, 4);
  });

  it("withholds a private contact's coordinates while the lock is closed", async () => {
    await prisma.address.create({
      data: { contactId: privateId, city: "Leeds", latitude: 53.8008, longitude: -1.5491 },
    });

    state.enabled = true;
    state.unlocked = true;
    expect((await originsFor(ownerId, privateId)).contact).not.toBeNull();

    // Locked, the section is simply not there — exactly as if they had no
    // address at all. A point that appears on unlock is itself an answer.
    state.unlocked = false;
    expect((await originsFor(ownerId, privateId)).contact).toBeNull();
  });

  it("does not read another account's home or address", async () => {
    const stranger = await createTestUser();
    await prisma.userPreference.create({
      data: { userId: stranger.id, homeLatitude: 48.8566, homeLongitude: 2.3522 },
    });
    const theirContact = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Someone" },
    });
    await prisma.address.create({
      data: { contactId: theirContact.id, latitude: 48.8566, longitude: 2.3522 },
    });

    const origins = await originsFor(ownerId, theirContact.id);
    expect(origins.home).toBeNull();
    expect(origins.contact).toBeNull();
  });
});
