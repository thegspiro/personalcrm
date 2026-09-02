import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ token: "current-token" }));
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: state.token }) }),
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
  it("password security preserves current, revokes others, and invalidates its privacy unlock", async () => {
    await secureSessionsAfterPasswordChange(ownerId);
    expect(
      await prisma.session.findUnique({ where: { id: otherId } }),
    ).toBeNull();
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: currentId } }))
        .privacyUnlockedAt,
    ).toBeNull();
  });
});
