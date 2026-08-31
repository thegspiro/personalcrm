import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: true,
  unlocked: false,
  acceptedPin: "482913",
}));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

vi.mock("@/server/privacy/lock", () => ({
  clearPin: vi.fn(),
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  lock: vi.fn(),
  requireUnlocked: vi.fn(),
  setPin: vi.fn(),
  unlock: async (pin: string) =>
    pin === state.acceptedPin ? { ok: true } : { ok: false, error: "That PIN is wrong." },
}));

const { setPrivacyLockEnabled, updatePrivacyPreferences } = await import(
  "@/server/actions/privacy"
);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe.skipIf(!hasTestDatabase)("privacy preference actions", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = true;
    state.unlocked = false;
    await prisma.user.update({ where: { id: user.id }, data: { privacyPinHash: "configured" } });
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

  const lockEnabled = async () =>
    (await prisma.userPreference.findUniqueOrThrow({ where: { userId: state.ownerId } }))
      .privacyLockEnabled;

  it("does not let general preference form data disable the lock", async () => {
    const result = await updatePrivacyPreferences(
      form({ privacyLockEnabled: "false", hideDating: "false", blurPrivateNotes: "false" }),
    );

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(true);
  });

  it("refuses a direct disable call from a locked session without the PIN", async () => {
    const result = await setPrivacyLockEnabled(form({ enabled: "false" }));

    expect(result).toEqual({ ok: false, error: "Unlock with your PIN first." });
    expect(await lockEnabled()).toBe(true);
  });

  it("refuses a direct disable call with the wrong PIN", async () => {
    const result = await setPrivacyLockEnabled(
      form({ enabled: "false", currentPin: "000000" }),
    );

    expect(result).toEqual({ ok: false, error: "That PIN is wrong." });
    expect(await lockEnabled()).toBe(true);
  });

  it("allows a direct disable call with the verified PIN", async () => {
    const result = await setPrivacyLockEnabled(
      form({ enabled: "false", currentPin: state.acceptedPin }),
    );

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(false);
  });

  it("allows an unlocked privacy session to disable without resubmitting the PIN", async () => {
    state.unlocked = true;

    const result = await setPrivacyLockEnabled(form({ enabled: "false" }));

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(false);
  });
});
