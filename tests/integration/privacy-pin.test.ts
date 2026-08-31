import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const request = vi.hoisted(() => ({ ownerId: "", sessionToken: null as string | null }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => request.sessionToken ? { value: request.sessionToken } : undefined,
  }),
}));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.ownerId } });
    const prefs = await prisma.userPreference.findUniqueOrThrow({ where: { userId: request.ownerId } });
    return { user, prefs, timezone: prefs.timezone };
  },
}));

const { clearPinAction, setPinAction, unlockPrivacyAction } = await import(
  "@/server/actions/privacy"
);

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const previous = { ok: true } as const;
const PIN = "482913";

describe.skipIf(!hasTestDatabase)("privacy PIN attempt backoff", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    request.ownerId = user.id;
    request.sessionToken = "first-session";
    await prisma.user.update({
      where: { id: user.id },
      data: { privacyPinHash: await hashPassword(PIN) },
    });
    // createTestUser does not provision preferences, and the getUserContext
    // mock above reads them with findUniqueOrThrow, so the row has to exist
    // before any action runs. The lock is on because that is what these
    // tests exercise.
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        timezone: "America/New_York",
        privacyLockEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("shares incorrect attempts across unlock, PIN replacement, removal, and sessions", async () => {
    const unlock = () => unlockPrivacyAction(previous, form({ pin: "0000" }));
    const replace = () => setPinAction(previous, form({
      currentPin: "1111",
      newPin: "2468",
      confirmPin: "2468",
    }));
    const remove = () => clearPinAction(previous, form({ currentPin: "2222" }));

    expect((await unlock()).error).toMatch(/PIN is wrong/i);
    expect((await replace()).error).toMatch(/current PIN is wrong/i);

    // A different browser session still belongs to the same account counter.
    request.sessionToken = "second-session";
    expect((await remove()).error).toMatch(/PIN is wrong/i);
    expect((await unlock()).error).toMatch(/PIN is wrong/i);

    // The fifth failure can arrive through any verifier-backed endpoint.
    const threshold = await replace();
    expect(threshold.retryAfterSeconds).toBeGreaterThan(0);
    expect(threshold.error).toMatch(/too many attempts/i);

    // Clearing cookies cannot clear a backoff stored on User.
    request.sessionToken = null;
    const afterCookiesCleared = await remove();
    expect(afterCookiesCleared.retryAfterSeconds).toBeGreaterThan(0);
    expect(afterCookiesCleared.error).toMatch(/too many attempts/i);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.ownerId } });
    expect(user.privacyPinFailedCount).toBe(5);
    expect(user.privacyPinFailedAt).not.toBeNull();
  });

  it("serializes concurrent failures so increments cannot be lost or pass the threshold", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) => index % 3 === 0
        ? unlockPrivacyAction(previous, form({ pin: "0000" }))
        : index % 3 === 1
          ? setPinAction(previous, form({ currentPin: "1111", newPin: "2468", confirmPin: "2468" }))
          : clearPinAction(previous, form({ currentPin: "2222" }))),
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.ownerId } });
    expect(user.privacyPinFailedCount).toBe(5);
    expect(attempts.some((result) => (result.retryAfterSeconds ?? 0) > 0)).toBe(true);

    const blocked = await unlockPrivacyAction(previous, form({ pin: PIN }));
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.error).toMatch(/too many attempts/i);
  });
});
