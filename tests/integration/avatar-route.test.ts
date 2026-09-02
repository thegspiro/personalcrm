import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findVisibleAvatarContact } from "@/server/queries/avatars";
import { IDLE_TIMEOUT_MS } from "@/server/privacy/lock";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The avatar route's one authorisation query, driven against real rows. It
 * restates getPrivacyState as a where-clause, so each branch of that function
 * is asserted here from the database side: no PIN, lock off, this session
 * unlocked in time, this session unlocked too long ago, a different session.
 */
describe.skipIf(!hasTestDatabase)("avatar visibility query", () => {
  const now = new Date("2026-09-02T12:00:00Z");
  const publicPath = `/api/avatars/${"a".repeat(32)}.png`;
  const tokenHash = "hash-of-this-session";
  let ownerId: string;

  async function privateContact(ownerId: string, isPrivate = true) {
    return prisma.contact.create({ data: { ownerId, firstName: "Robin", isPrivate, avatarPath: publicPath } });
  }

  async function session(userId: string, hash: string, privacyUnlockedAt: Date | null) {
    return prisma.session.create({
      data: { userId, tokenHash: hash, expiresAt: new Date(now.getTime() + 86_400_000), privacyUnlockedAt },
    });
  }

  function lookup(sessionTokenHash: string | null = tokenHash) {
    return findVisibleAvatarContact(prisma, { ownerId, publicPath, sessionTokenHash, now });
  }

  beforeEach(async () => {
    await reset();
    ownerId = (await createTestUser()).id;
  });
  afterAll(() => prisma.$disconnect());

  it("never returns another owner's contact, private or not", async () => {
    const other = await createTestUser();
    await privateContact(other.id, false);
    expect(await lookup()).toBeNull();
  });

  it("returns a contact that is not private whatever the lock is doing", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.create({ data: { userId: ownerId, privacyLockEnabled: true } });
    const contact = await privateContact(ownerId, false);
    expect(await lookup(null)).toEqual({ id: contact.id });
  });

  it("returns a private contact while the lock cannot be on: no PIN, or the switch off", async () => {
    const contact = await privateContact(ownerId);
    await prisma.userPreference.create({ data: { userId: ownerId, privacyLockEnabled: true } });
    expect(await lookup(null)).toEqual({ id: contact.id });

    await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.update({ where: { userId: ownerId }, data: { privacyLockEnabled: false } });
    expect(await lookup(null)).toEqual({ id: contact.id });
  });

  it("withholds a private contact while locked unless this session opened the lock in time", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.create({ data: { userId: ownerId, privacyLockEnabled: true } });
    const contact = await privateContact(ownerId);
    expect(await lookup(null)).toBeNull();

    const row = await session(ownerId, tokenHash, new Date(now.getTime() - 60_000));
    expect(await lookup()).toEqual({ id: contact.id });

    // The boundary is closed, exactly as isUnlockActive has it.
    await prisma.session.update({ where: { id: row.id }, data: { privacyUnlockedAt: new Date(now.getTime() - IDLE_TIMEOUT_MS) } });
    expect(await lookup()).toBeNull();
    await prisma.session.update({ where: { id: row.id }, data: { privacyUnlockedAt: new Date(now.getTime() - IDLE_TIMEOUT_MS + 1) } });
    expect(await lookup()).toEqual({ id: contact.id });

    // An unlock in the future is a clock skew, not an unlock.
    await prisma.session.update({ where: { id: row.id }, data: { privacyUnlockedAt: new Date(now.getTime() + 1) } });
    expect(await lookup()).toBeNull();
  });

  it("does not let one session's unlock open another's", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.create({ data: { userId: ownerId, privacyLockEnabled: true } });
    await privateContact(ownerId);
    await session(ownerId, "hash-of-the-other-session", now);
    expect(await lookup()).toBeNull();
  });

  it("treats an owner with a PIN but no preference row as locked", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
    await privateContact(ownerId);
    expect(await lookup()).toBeNull();
  });
});
