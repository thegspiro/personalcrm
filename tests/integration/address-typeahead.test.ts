import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * What leaves the machine when an address field suggests as you type.
 *
 * The field decides not to ask for a private contact, and that is worth having
 * — but a server action is a public POST endpoint, so the only guarantee is the
 * one the action itself makes. These tests drive the real action and read
 * `state.sent`, which is every query that reached a provider: an empty array is
 * the assertion, not a stubbed refusal.
 */

const state = vi.hoisted(() => ({
  ownerId: "",
  unlocked: true,
  typeahead: true,
  /** Every query that actually reached the provider, in order. */
  sent: [] as { query: string; interactive: boolean }[],
  /** What the stubbed provider answers with: `null` is an endpoint that did not. */
  answer: [] as unknown[] | null,
}));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: true,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
  requireUnlocked: async () =>
    state.unlocked ? { ok: true } : { ok: false, error: "Unlock to continue." },
}));

// One snapshot, matching what `searchPlaces` actually reads: it takes a single
// `getGeoStatus()` so the endpoint it sends to and the permission it checks
// cannot describe different settings.
vi.mock("@/server/geo/config", () => ({
  getGeoStatus: async () => ({
    enabled: true,
    provider: "photon" as const,
    baseUrl: "http://box.local:2322",
    usable: true,
    typeaheadCapable: true,
    typeahead: state.typeahead,
  }),
}));

// The real module apart from the network call, so the shaping and the host
// rules stay the ones that ship.
vi.mock("@/server/geo/providers", async () => {
  const actual = await vi.importActual<typeof import("@/server/geo/providers")>(
    "@/server/geo/providers",
  );
  return {
    ...actual,
    searchAddress: async (
      _config: unknown,
      query: string,
      options: { interactive?: boolean } = {},
    ) => {
      state.sent.push({ query, interactive: options.interactive === true });
      return state.answer;
    },
  };
});

const { lookupContactAddress } = await import("@/server/actions/details");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!hasTestDatabase)("suggesting a contact's address", () => {
  let openId = "";
  let privateId = "";

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.unlocked = true;
    state.typeahead = true;
    state.sent = [];
    state.answer = [];

    const open = await prisma.contact.create({
      data: { ownerId: user.id, firstName: "Dana", lastName: "Okafor" },
    });
    const hidden = await prisma.contact.create({
      data: { ownerId: user.id, firstName: "Robin", lastName: "Vale", isPrivate: true },
    });
    openId = open.id;
    privateId = hidden.id;
  });

  afterAll(() => prisma.$disconnect());

  it("sends the address and nothing else", async () => {
    const result = await lookupContactAddress(
      form({
        contactId: openId,
        query: "120 Maple Street, Arlington, Virginia",
        interactive: "1",
      }),
    );

    expect(result.ok).toBe(true);
    expect(state.sent).toEqual([
      { query: "120 Maple Street, Arlington, Virginia", interactive: true },
    ]);
    // Never the label, never the notes, and never the name of the person who
    // lives there — the query is the whole of what was sent.
    const [only] = state.sent;
    expect(only.query).not.toContain("Dana");
    expect(only.query).not.toContain("Okafor");
  });

  it("sends nothing at all for a private contact", async () => {
    const result = await lookupContactAddress(
      form({ contactId: privateId, query: "9 Alder Row, Leeds", interactive: "1" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("private");
    // The refusal is before any provider is reached, so a private address is
    // never on the wire even for the instant it would take to be rejected.
    expect(state.sent).toEqual([]);
  });

  it("still sends nothing for a private contact when the lock is open", async () => {
    // Unlocking reveals a private person; it is not consent to transmit them.
    state.unlocked = true;
    await lookupContactAddress(
      form({ contactId: privateId, query: "9 Alder Row, Leeds", interactive: "1" }),
    );
    expect(state.sent).toEqual([]);
  });

  it("refuses to suggest while typing when that was never asked for", async () => {
    // The claim comes from the browser, so it is re-checked against the stored
    // setting rather than believed.
    state.typeahead = false;

    const result = await lookupContactAddress(
      form({ contactId: openId, query: "120 Maple Street", interactive: "1" }),
    );

    expect(result.ok).toBe(false);
    expect(state.sent).toEqual([]);
  });

  it("still answers the button when suggestions while typing are off", async () => {
    state.typeahead = false;

    const result = await lookupContactAddress(
      form({ contactId: openId, query: "120 Maple Street" }),
    );

    expect(result.ok).toBe(true);
    expect(state.sent).toEqual([{ query: "120 Maple Street", interactive: false }]);
  });

  it("does not reach another account's contact", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Sam", lastName: "Reyes" },
    });

    const result = await lookupContactAddress(
      form({ contactId: theirs.id, query: "1 High Street", interactive: "1" }),
    );

    expect(result.ok).toBe(false);
    expect(state.sent).toEqual([]);
  });

  it("says a lookup failed rather than that nothing matched", async () => {
    // An endpoint that does not answer used to be indistinguishable from one
    // that answered "no such place". Two things went wrong with that: the user
    // was told their address was not found when it had never been looked for,
    // and a field suggesting while you type had no way to know it should stop
    // asking, so every pause spent the whole timeout again.
    state.answer = null;

    const result = await lookupContactAddress(
      form({ contactId: openId, query: "120 Maple Street", interactive: "1" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("didn't work");
    // It was reached — this is a failure to answer, not a refusal to send.
    expect(state.sent).toEqual([{ query: "120 Maple Street", interactive: true }]);
  });

  it("still reports an empty answer as an empty answer", async () => {
    state.answer = [];

    const result = await lookupContactAddress(
      form({ contactId: openId, query: "120 Maple Street", interactive: "1" }),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([]);
  });
});
