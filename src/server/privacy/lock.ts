import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_COOKIE } from "@/server/auth/session";
import { getUserContext } from "@/server/user/context";

/**
 * The secondary privacy lock.
 *
 * What this is, precisely: an access gate against someone holding your already
 * unlocked device — a partner, a colleague, a borrowed laptop. It is NOT
 * encryption. Every row is stored in plain text, so anyone who can read
 * /config or a database backup can read this data whether or not a PIN is set.
 * The setup screen says so rather than implying protection it does not have.
 *
 * Two design points that matter:
 *
 *  * Unlock state lives on the server session row, never in a cookie or in
 *    client state. A client cannot claim to be unlocked.
 *  * Enforcement happens in the query layer (see ./filter.ts), not in
 *    components. A component that renders nothing is not a lock — the data
 *    would still be sitting in the RSC payload.
 */

/** How long an unlock lasts without further activity. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Failed attempts before backoff kicks in. */
const FAILURES_BEFORE_BACKOFF = 5;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

export interface PrivacyState {
  /** A PIN has been configured. */
  pinSet: boolean;
  /** The lock is switched on. Without this, everything is visible as normal. */
  enabled: boolean;
  /** Private content may be shown right now. */
  unlocked: boolean;
  /** Seconds until a locked-out user may try again, or 0. */
  retryAfterSeconds: number;
  /** Epoch milliseconds when this session will close without more activity. */
  unlockedUntilMs: number | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The session row backing this request, if any. */
async function currentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, privacyUnlockedAt: true },
  });
}

/**
 * Backoff after repeated wrong PINs. Tracked on the user rather than the
 * session so clearing cookies does not reset a lockout.
 */
export function backoffRemainingMs(failedCount: number, failedAt: Date | null): number {
  if (!failedAt || failedCount < FAILURES_BEFORE_BACKOFF) return 0;
  const over = failedCount - FAILURES_BEFORE_BACKOFF;
  const delay = Math.min(MAX_BACKOFF_MS, 2 ** over * 5_000);
  return Math.max(0, failedAt.getTime() + delay - Date.now());
}

/**
 * Whether private content may be shown for this request.
 *
 * Memoised per request: it is consulted by nearly every query, and they should
 * all see one consistent answer even if the timeout lapses mid-render.
 */
export const getPrivacyState = cache(async (): Promise<PrivacyState> => {
  const { user, prefs } = await getUserContext();

  const pinSet = Boolean(user.privacyPinHash);
  const enabled = prefs.privacyLockEnabled && pinSet;
  const retryAfterSeconds = Math.ceil(
    backoffRemainingMs(user.privacyPinFailedCount, user.privacyPinFailedAt) / 1000,
  );

  // With the lock off, nothing is gated — including anything marked private.
  if (!enabled) {
    return { pinSet, enabled: false, unlocked: true, retryAfterSeconds, unlockedUntilMs: null };
  }

  const session = await currentSession();
  const unlockedAt = session?.privacyUnlockedAt ?? null;
  const unlocked = Boolean(unlockedAt && Date.now() - unlockedAt.getTime() < IDLE_TIMEOUT_MS);

  return {
    pinSet,
    enabled: true,
    unlocked,
    retryAfterSeconds,
    unlockedUntilMs: unlocked && unlockedAt ? unlockedAt.getTime() + IDLE_TIMEOUT_MS : null,
  };
});

export interface UnlockResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
}

type VerifySuccess = (tx: Prisma.TransactionClient) => Promise<void>;

/**
 * Verify the account PIN while holding a row lock on its user-level attempt
 * counters. The lock makes the read/check/increment one indivisible operation:
 * concurrent requests (including requests from other sessions and endpoints)
 * cannot all observe the same count and lose increments or slip past backoff.
 */
async function verifyPin(
  userId: string,
  suppliedPin: string,
  wrongPinError: string,
  onVerified?: VerifySuccess,
): Promise<UnlockResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        privacyPinHash: string | null;
        privacyPinFailedCount: number;
        privacyPinFailedAt: Date | null;
      }>
    >`SELECT privacyPinHash, privacyPinFailedCount, privacyPinFailedAt
       FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
    const user = rows[0];
    if (!user?.privacyPinHash) return { ok: false, error: "No PIN is set." };

    const waitMs = backoffRemainingMs(user.privacyPinFailedCount, user.privacyPinFailedAt);
    if (waitMs > 0) {
      return {
        ok: false,
        error: "Too many attempts. Wait a moment and try again.",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      };
    }

    const matches = await verifyPassword(suppliedPin.trim(), user.privacyPinHash);
    if (!matches) {
      const failedCount = user.privacyPinFailedCount + 1;
      const failedAt = new Date();
      await tx.user.update({
        where: { id: userId },
        data: { privacyPinFailedCount: failedCount, privacyPinFailedAt: failedAt },
      });
      const retryAfterSeconds = Math.ceil(backoffRemainingMs(failedCount, failedAt) / 1000);
      return {
        ok: false,
        error: retryAfterSeconds > 0
          ? "Too many attempts. Wait a moment and try again."
          : wrongPinError,
        retryAfterSeconds,
      };
    }

    await tx.user.update({
      where: { id: userId },
      data: { privacyPinFailedCount: 0, privacyPinFailedAt: null },
    });
    await onVerified?.(tx);
    return { ok: true };
  });
}

/** Set or replace the PIN. Replacing one requires the current PIN. */
export async function setPin(newPin: string, currentPin?: string): Promise<UnlockResult> {
  const { user } = await getUserContext();

  const digits = newPin.trim();
  if (!/^\d+$/.test(digits)) return { ok: false, error: "Use digits only." };
  if (digits.length < PIN_MIN_LENGTH || digits.length > PIN_MAX_LENGTH) {
    return { ok: false, error: `Use between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits.` };
  }

  if (user.privacyPinHash) {
    if (!currentPin) return { ok: false, error: "Enter your current PIN." };
    const hash = await hashPassword(digits);
    const result = await verifyPin(user.id, currentPin, "That current PIN is wrong.", async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { privacyPinHash: hash } });
    });
    if (!result.ok) return result;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        privacyPinHash: await hashPassword(digits),
        privacyPinFailedCount: 0,
        privacyPinFailedAt: null,
      },
    });
  }

  // Setting a PIN implies you can see your own data right now.
  const session = await currentSession();
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { privacyUnlockedAt: new Date() },
    });
  }
  return { ok: true };
}

/** Remove the PIN entirely, which also switches the lock off. */
export async function clearPin(currentPin: string): Promise<UnlockResult> {
  const { user } = await getUserContext();
  if (!user.privacyPinHash) return { ok: true };

  return verifyPin(user.id, currentPin, "That PIN is wrong.", async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { privacyPinHash: null } });
    await tx.userPreference.update({
      where: { userId: user.id },
      data: { privacyLockEnabled: false },
    });
  });
}

/** Verify the PIN and open the lock for this session. */
export async function unlock(pin: string): Promise<UnlockResult> {
  const { user } = await getUserContext();
  if (!user.privacyPinHash) return { ok: false, error: "No PIN is set." };

  const result = await verifyPin(user.id, pin, "That PIN is wrong.");
  if (!result.ok) return result;
  const session = await currentSession();
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { privacyUnlockedAt: new Date() },
    });
  }
  return { ok: true };
}

/** Close the lock immediately on this session. */
export async function lock(): Promise<void> {
  const session = await currentSession();
  if (!session) return;
  await prisma.session.update({
    where: { id: session.id },
    data: { privacyUnlockedAt: null },
  });
}

/**
 * Push the idle timeout out. Called on unlock and whenever an unlocked user
 * touches private content, so browsing keeps the lock open but walking away
 * closes it.
 */
export async function touchUnlock(): Promise<void> {
  const session = await currentSession();
  if (!session?.privacyUnlockedAt) return;
  // One write per minute is enough to implement a sliding timeout. Without
  // the timestamp predicate, every click in an active session would become a
  // database write; the predicate also makes concurrent browser tabs cheap.
  await prisma.session.updateMany({
    where: {
      id: session.id,
      privacyUnlockedAt: { lt: new Date(Date.now() - 60_000) },
    },
    data: { privacyUnlockedAt: new Date() },
  });
}

/** True when the caller must be sent to the unlock screen. */
export async function isLocked(): Promise<boolean> {
  const state = await getPrivacyState();
  return state.enabled && !state.unlocked;
}

/**
 * Guard for write actions that touch private content.
 *
 * Pages redirect when locked, but server actions are ordinary POST endpoints —
 * anyone holding the session cookie can call one directly, so gating the page
 * alone would leave the lock trivially bypassable. Actions check here.
 *
 * It also stops a confusing case: marking something private while locked would
 * make it vanish immediately, with no way to undo it without unlocking.
 */
export async function requireUnlocked(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { enabled, unlocked } = await getPrivacyState();
  if (!enabled || unlocked) return { ok: true };
  return { ok: false, error: "Unlock with your PIN first." };
}
