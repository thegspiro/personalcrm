import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", unlocked: true }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));
vi.mock("@/server/privacy/lock", () => ({
  requireUnlocked: async () =>
    state.unlocked ? { ok: true } : { ok: false, error: "Unlock with your PIN first." },
  getPrivacyState: async () => ({ enabled: !state.unlocked, unlocked: state.unlocked }),
}));
vi.mock("@/server/privacy/filter", async () => {
  const actual = await vi.importActual<typeof import("@/server/privacy/where")>(
    "@/server/privacy/where",
  );
  return { ...actual, privacyScope: async () => ({ enabled: true, unlocked: state.unlocked }) };
});

const { mergeDuplicate } = await import("@/server/actions/duplicates");

/**
 * The merge action, as the public POST endpoint it is.
 *
 * Two things are checked here that the service cannot check for itself: that
 * the request is parsed at all — a schema that silently refuses every real
 * merge is indistinguishable from a broken feature — and that a crafted
 * request cannot write a value of its own choosing onto a contact.
 */
describe.skipIf(!hasTestDatabase)("merging through the action", () => {
  let winnerId: string;
  let loserId: string;

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  beforeEach(async () => {
    await reset();
    state.unlocked = true;
    state.ownerId = (await createTestUser()).id;
    winnerId = (
      await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Keeper", city: "Leeds" },
      })
    ).id;
    loserId = (
      await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Folded", city: "York" },
      })
    ).id;
  });
  afterAll(() => prisma.$disconnect());

  it("accepts a choice for only the fields that disagree", async () => {
    // Zod 4 records keyed by an enum are exhaustive, so the obvious spelling of
    // this schema demanded an answer for all twenty-two columns and refused
    // every merge the screen can actually produce. It failed as "could not be
    // read", with nothing in the server log.
    const result = await mergeDuplicate(
      form({ winnerId, loserId, choices: JSON.stringify({ city: "loser" }) }),
    );

    expect(result.ok, result.error).toBe(true);
    const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: winnerId } });
    expect(survivor.city).toBe("York");
    expect(await prisma.contact.count({ where: { id: loserId } })).toBe(0);
  });

  it("merges with no choices at all when nothing disagrees", async () => {
    const result = await mergeDuplicate(
      form({ winnerId, loserId, choices: JSON.stringify({}) }),
    );
    expect(result.ok, result.error).toBe(true);
  });

  it("takes the value off the chosen record, never off the request", async () => {
    // The form sends a side, not a value. The worst a crafted request can do is
    // pick the other person's real answer.
    const result = await mergeDuplicate(
      form({
        winnerId,
        loserId,
        choices: JSON.stringify({ city: "loser", firstName: "winner" }),
      }),
    );
    expect(result.ok).toBe(true);

    const survivor = await prisma.contact.findUniqueOrThrow({ where: { id: winnerId } });
    expect(survivor.city).toBe("York");
    expect(survivor.firstName).toBe("Keeper");
  });

  it("ignores a column the screen never offers", async () => {
    const result = await mergeDuplicate(
      form({ winnerId, loserId, choices: JSON.stringify({ isPrivate: "loser" }) }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses while the privacy lock is closed", async () => {
    state.unlocked = false;
    const result = await mergeDuplicate(
      form({ winnerId, loserId, choices: JSON.stringify({}) }),
    );
    expect(result.ok).toBe(false);
    expect(await prisma.contact.count({ where: { id: loserId } })).toBe(1);
  });

  it("refuses a malformed choices payload rather than throwing", async () => {
    const result = await mergeDuplicate(form({ winnerId, loserId, choices: "not json" }));
    expect(result.ok).toBe(false);
    expect(await prisma.contact.count({ where: { id: loserId } })).toBe(1);
  });
});
