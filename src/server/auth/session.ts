import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/server/db/client";

export const SESSION_COOKIE = "pcrm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Refresh the expiry when the session is more than a quarter used up. */
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS * 0.75;

/** How a session row is keyed: the cookie holds the token, the database its hash. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function currentTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

export interface SafeSession {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
  privacyUnlocked: boolean;
}

/** Account-facing session metadata. Token material never leaves this module. */
export async function listSessions(userId: string): Promise<SafeSession[]> {
  const tokenHash = await currentTokenHash();
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tokenHash: true,
      createdAt: true,
      expiresAt: true,
      userAgent: true,
      ip: true,
      privacyUnlockedAt: true,
    },
  });
  return rows.map(({ tokenHash: storedHash, privacyUnlockedAt, ...row }) => ({
    ...row,
    current: tokenHash === storedHash,
    privacyUnlocked: privacyUnlockedAt !== null,
  }));
}

/** Delete an owned, non-current session. The compound predicate prevents IDOR. */
export async function revokeOtherSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const tokenHash = await currentTokenHash();
  if (!tokenHash) return false;
  const result = await prisma.session.deleteMany({
    where: { id: sessionId, userId, tokenHash: { not: tokenHash } },
  });
  return result.count === 1;
}

export async function revokeAllOtherSessions(userId: string): Promise<number> {
  const tokenHash = await currentTokenHash();
  if (!tokenHash) return 0;
  return (
    await prisma.session.deleteMany({
      where: { userId, tokenHash: { not: tokenHash } },
    })
  ).count;
}

/**
 * Password changes re-key this login, close its privacy unlock, and end every
 * other login.
 *
 * Re-keying is what makes the rest of it worth anything. Deleting the other
 * rows ends the sessions holding a *different* token — but a stolen cookie is
 * a copy of this one, so it hashes to the same value, resolves to the same
 * row, and was therefore the single session the sweep was careful to keep.
 * Changing the password to get an intruder out left them signed in. The
 * surviving row is given a freshly generated token instead, which retires
 * every copy of the old cookie, this browser's included; the response then
 * carries the new one so the owner stays signed in.
 *
 * The expiry is reset with it, because the cookie has to be rewritten anyway
 * and a password just confirmed is as good a proof of presence as a login.
 *
 * The database work takes an optional transaction client so a caller can
 * commit it together with the new password hash. Split across two commits, a
 * failure here leaves the password changed and every other session alive
 * while the action reports failure — and the old password no longer works to
 * try again.
 *
 * The cookie is not written here but by the callback this returns, which the
 * caller invokes *after* the transaction commits. Written inside it, a
 * rollback would leave the browser holding a token no row has — signing the
 * owner out of an account whose password did not change.
 */
export async function secureSessionsAfterPasswordChange(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<() => Promise<void>> {
  const unchanged = async () => {};
  const tokenHash = await currentTokenHash();
  if (!tokenHash) return unchanged;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const run = async (client: Prisma.TransactionClient) => {
    await client.session.deleteMany({
      where: { userId, tokenHash: { not: tokenHash } },
    });
    return client.session.updateMany({
      where: { userId, tokenHash },
      data: { tokenHash: hashSessionToken(token), privacyUnlockedAt: null, expiresAt },
    });
  };
  const { count } = tx ? await run(tx) : await prisma.$transaction(run);
  // Nothing was re-keyed: the cookie belongs to someone else's session, or to
  // one already expired and swept. Handing this browser the unused token would
  // match no row and sign it out.
  if (count === 0) return unchanged;
  return async () => {
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureContext(),
      path: "/",
      expires: expiresAt,
    });
  };
}

function isSecureContext(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 255) ?? null,
      ip: meta?.ip?.slice(0, 64) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolve the signed-in user for this request. Memoised per request so layouts
 * and pages that each need the user only hit the database once.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive) return null;

  // Sliding expiry: extend long-lived sessions without writing on every request.
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining < REFRESH_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => {});
  }

  return session.user;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
