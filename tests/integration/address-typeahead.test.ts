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

vi.mock("@/server/geo/config", () => ({
  lookupAvailable: async () => true,
  currentGeoConfig: async () => ({ provider: "photon", baseUrl: "http://box.local:2322" }),
  typeaheadEnabled: async () => state.typeahead,
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
      return [];
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
});
