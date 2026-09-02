import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";

export const SESSION_COOKIE = "pcrm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Refresh the expiry when the session is more than a quarter used up. */
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS * 0.75;

/** How a session row is keyed: the cookie holds the token, the database its hash. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
