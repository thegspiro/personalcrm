import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  token: "current-token",
  written: null as null | { name: string; value: string; options: Record<string, unknown> },
}));
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: state.token }),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.written = { name, value, options };
    },
  }),
}));
const {
  listSessions,
  revokeAllOtherSessions,
  revokeOtherSession,
  secureSessionsAfterPasswordChange,
} = await import("@/server/auth/session");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.skipIf(!hasTestDatabase)("account session controls", () => {
  let ownerId: string;
  let currentId: string;
  let otherId: string;
  beforeEach(async () => {
    await reset();
    state.token = "current-token";
    state.written = null;
    ownerId = (await createTestUser()).id;
    const stranger = await createTestUser();
    currentId = (
      await prisma.session.create({
        data: {
          userId: ownerId,
          tokenHash: hash(state.token),
          expiresAt: new Date(Date.now() + 60_000),
          privacyUnlockedAt: new Date(),
        },
      })
    ).id;
    otherId = (
      await prisma.session.create({
        data: {
          userId: ownerId,
          tokenHash: hash("other"),
          expiresAt: new Date(Date.now() + 60_000),
          privacyUnlockedAt: new Date(),
        },
      })
    ).id;
    await prisma.session.create({
      data: {
        userId: stranger.id,
        tokenHash: hash("stranger"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });
  afterAll(() => prisma.$disconnect());

  it("returns safe metadata and marks the current session without exposing hashes", async () => {
    const sessions = await listSessions(ownerId);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((row) => row.id === currentId)?.current).toBe(true);
    expect(sessions.some((row) => "tokenHash" in row)).toBe(false);
  });
  it("cannot revoke the current or another owner's session", async () => {
    expect(await revokeOtherSession(ownerId, currentId)).toBe(false);
    const foreign = await prisma.session.findFirstOrThrow({
      where: { userId: { not: ownerId } },
    });
    expect(await revokeOtherSession(ownerId, foreign.id)).toBe(false);
  });
  it("revokes one or all other sessions while preserving current", async () => {
    expect(await revokeOtherSession(ownerId, otherId)).toBe(true);
    await prisma.session.create({
      data: {
        userId: ownerId,
        tokenHash: hash("again"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await revokeAllOtherSessions(ownerId)).toBe(1);
    expect(
      await prisma.session.findUnique({ where: { id: currentId } }),
    ).not.toBeNull();
  });
  it("password security re-keys this login, revokes the others, and closes its unlock", async () => {
    const applyRotatedCookie = await secureSessionsAfterPasswordChange(ownerId);
    await applyRotatedCookie();
    expect(
      await prisma.session.findUnique({ where: { id: otherId } }),
    ).toBeNull();
    const survivor = await prisma.session.findUniqueOrThrow({
      where: { id: currentId },
    });
    expect(survivor.privacyUnlockedAt).toBeNull();
    // The row kept for this browser is where the whole point lives. A stolen
    // copy of the cookie hashes to the value below, and sweeping the *other*
    // rows never touched it: changing the password to evict an intruder left
    // them holding a session that still resolved.
    expect(survivor.tokenHash).not.toBe(hash(state.token));
    expect(state.written?.name).toBe("pcrm_session");
    expect(hash(state.written?.value ?? "")).toBe(survivor.tokenHash);
    expect(state.written?.options.httpOnly).toBe(true);
    expect(state.written?.options.path).toBe("/");
  });

  it("writes no cookie when the request's cookie re-keys nothing", async () => {
    state.token = "belongs-to-no-session";
    const applyRotatedCookie = await secureSessionsAfterPasswordChange(ownerId);
    await applyRotatedCookie();
    // Handing this browser a token no row carries would sign it out of an
    // account whose password had just been changed successfully.
    expect(state.written).toBeNull();
  });
});
