import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Placing everything at once.
 *
 * The risky parts are all about restraint rather than about geocoding: that an
 * ambiguous answer is left alone, that a row nobody can match does not trap the
 * pass in a loop, that a private contact's address is never sent, and that a
 * pass cannot reach another account's rows or overwrite a coordinate somebody
 * typed. The provider itself is stubbed — what it returns is the input to those
 * rules, not the thing under test.
 */

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: true,
  unlocked: true,
  /** Base URL the config hands back, so the public-endpoint refusal is testable. */
  baseUrl: "http://localhost:8080",
  /** Keyed by the query the action builds, so each row can answer differently. */
  answers: new Map<string, unknown[]>(),
  /** Every query the action actually sent, in order. */
  sent: [] as string[],
}));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
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

vi.mock("@/server/geo/config", () => ({
  lookupAvailable: async () => true,
  currentGeoConfig: async () => ({ provider: "custom", baseUrl: state.baseUrl }),
}));

// The real module's rate-limit test is kept — it is the rule the action leans
// on — while the network call is replaced.
vi.mock("@/server/geo/providers", async () => {
  const actual = await vi.importActual<typeof import("@/server/geo/providers")>(
    "@/server/geo/providers",
  );
  return {
    ...actual,
    searchAddress: async (_config: unknown, query: string) => {
      state.sent.push(query);
      return state.answers.get(query) ?? [];
    },
  };
});

const { placeUnplaced } = await import("@/server/actions/bulk-place");

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

function candidate(lat: string, lon: string, extra: Record<string, unknown> = {}) {
  return {
    label: "Somewhere",
    address: "Somewhere",
    city: "Leeds",
    region: null,
    country: "United Kingdom",
    latitude: lat,
    longitude: lon,
    osmType: "N",
    osmId: "123456789012",
    ...extra,
  };
}

describe.skipIf(!hasTestDatabase)("placing rows in bulk", () => {
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
    state.baseUrl = "http://localhost:8080";
    state.answers = new Map();
    state.sent = [];

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

  async function place(name: string, extra: Record<string, unknown> = {}) {
    return prisma.location.create({
      data: { ownerId, name, normalizedName: name.toLowerCase(), ...extra },
    });
  }

  it("writes only an unambiguous match, and leaves the rest for a person", async () => {
    const single = await place("Corner Cafe", { city: "Leeds" });
    const ambiguous = await place("The Crown", { city: "Leeds" });
    const nothing = await place("Nowhere At All");

    state.answers.set("Corner Cafe, Leeds", [candidate("53.8008", "-1.5491")]);
    // Two answers and nobody present to choose between them. A pin in the wrong
    // city looks answered when it is not, so neither is written.
    state.answers.set("The Crown, Leeds", [
      candidate("53.8008", "-1.5491"),
      candidate("51.5072", "-0.1276"),
    ]);
    state.answers.set("Nowhere At All", []);

    const result = await placeUnplaced(form({ kind: "places" }));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ processed: 3, placed: 1, skipped: 2 });

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: single.id } });
    expect(Number(saved.latitude)).toBeCloseTo(53.8008, 4);
    expect(saved.osmType).toBe("N");
    expect(saved.osmId).toBe(123456789012n);

    for (const id of [ambiguous.id, nothing.id]) {
      const row = await prisma.location.findUniqueOrThrow({ where: { id } });
      expect(row.latitude).toBeNull();
      expect(row.osmType).toBeNull();
    }
  });

  it("moves past a row it could not match rather than retrying it forever", async () => {
    // Ordered by id, so the cursor is total and stable. Names are irrelevant to
    // the ordering on purpose: a rename mid-pass must not move a row across it.
    for (let i = 0; i < 3; i += 1) await place(`Unmatchable ${i}`);

    const first = await placeUnplaced(form({ kind: "places" }));
    expect(first.data?.placed).toBe(0);
    expect(first.data?.skipped).toBe(3);
    // Nothing after this page, so the pass is finished even though three rows
    // are still unplaced — those are the ones nobody could match.
    expect(first.data?.nextCursor).toBeNull();
    expect(first.data?.remaining).toBe(0);
    expect(state.sent).toHaveLength(3);
  });

  it("hands back a cursor that advances when there is more to do", async () => {
    // More than one batch of ten.
    for (let i = 0; i < 12; i += 1) await place(`Place ${String(i).padStart(2, "0")}`);

    const first = await placeUnplaced(form({ kind: "places" }));
    expect(first.data?.processed).toBe(10);
    expect(first.data?.remaining).toBe(2);
    const cursor = first.data?.nextCursor;
    expect(cursor).toBeTruthy();

    const second = await placeUnplaced(form({ kind: "places", cursor: cursor! }));
    expect(second.data?.processed).toBe(2);
    expect(second.data?.nextCursor).toBeNull();
    expect(second.data?.remaining).toBe(0);
  });

  it("never sends a private contact's address, and never counts it", async () => {
    await prisma.address.create({
      data: { contactId: danaId, line1: "2 Boar Lane", city: "Leeds" },
    });
    await prisma.address.create({
      data: { contactId: privateId, line1: "Secret Street", city: "Leeds" },
    });
    state.answers.set("2 Boar Lane, Leeds", [candidate("53.7965", "-1.5478")]);

    // Unlocked, so the lock is not what is doing the work here — the rule holds
    // whatever the lock says, exactly as it does for a single lookup.
    state.enabled = true;
    state.unlocked = true;

    const result = await placeUnplaced(form({ kind: "addresses" }));
    expect(result.data).toMatchObject({ processed: 1, placed: 1 });
    expect(state.sent).toEqual(["2 Boar Lane, Leeds"]);
    expect(state.sent.join(" ")).not.toContain("Secret Street");

    const hidden = await prisma.address.findFirstOrThrow({ where: { contactId: privateId } });
    expect(hidden.latitude).toBeNull();
  });

  it("refuses to run against the public OpenStreetMap service", async () => {
    // Their usage policy asks applications not to geocode in bulk against
    // hardware the foundation runs on donations.
    state.baseUrl = "https://nominatim.openstreetmap.org";
    await place("Corner Cafe");

    const result = await placeUnplaced(form({ kind: "places" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("bulk");
    expect(state.sent).toHaveLength(0);
  });

  it("never overwrites coordinates that are already there", async () => {
    await place("Already Placed", { latitude: 10, longitude: 10 });
    state.answers.set("Already Placed", [candidate("53.8008", "-1.5491")]);

    const result = await placeUnplaced(form({ kind: "places" }));
    expect(result.data?.processed).toBe(0);
    expect(state.sent).toHaveLength(0);

    const row = await prisma.location.findFirstOrThrow({ where: { name: "Already Placed" } });
    expect(Number(row.latitude)).toBeCloseTo(10, 6);
  });

  it("cannot reach another account's rows", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.location.create({
      data: { ownerId: stranger.id, name: "Theirs", normalizedName: "theirs" },
    });
    const theirContact = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Someone" },
    });
    await prisma.address.create({
      data: { contactId: theirContact.id, line1: "Their Street" },
    });

    expect((await placeUnplaced(form({ kind: "places" }))).data?.processed).toBe(0);
    expect((await placeUnplaced(form({ kind: "addresses" }))).data?.processed).toBe(0);
    expect(state.sent).toHaveLength(0);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: theirs.id } })).latitude).toBeNull();
  });

  it("refuses half a pair from the provider rather than placing it wrongly", async () => {
    await place("Half Answer");
    state.answers.set("Half Answer", [candidate("53.8008", null as unknown as string)]);

    const result = await placeUnplaced(form({ kind: "places" }));
    expect(result.data).toMatchObject({ placed: 0, skipped: 1 });
    expect((await prisma.location.findFirstOrThrow({ where: { name: "Half Answer" } })).latitude).toBeNull();
  });

  it("rejects a kind it does not recognise", async () => {
    expect((await placeUnplaced(form({ kind: "everything" }))).ok).toBe(false);
    expect((await placeUnplaced(form({}))).ok).toBe(false);
  });
});
