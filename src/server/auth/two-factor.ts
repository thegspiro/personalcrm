import "server-only";
import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret } from "@/server/crypto/secrets";
import { generateSecret, verifyTotp } from "@/server/crypto/totp";

/**
 * Two-factor enrolment and verification.
 *
 * The shape that matters: an *unconfirmed* row never gates anything. Enrolment
 * writes the secret, hands back the key to put in an authenticator, and only
 * marks the row confirmed once a code proves the app holds the same secret.
 * Marking it on creation instead is how somebody locks themselves out with a
 * typo, and on a self-hosted app with no password recovery that is permanent.
 */

const RECOVERY_CODE_COUNT = 10;
/** 5 random bytes, base32-ish, in two groups. Short enough to type, ample. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_GROUP = 5;

export function hashRecoveryCode(code: string): string {
  // High-entropy and random, so there is nothing for a slow hash to protect;
  // sha256 is what lets a recovery attempt be one indexed lookup.
  return createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");
}

/** Case and dashes are how a person types one off a printout. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function newRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < RECOVERY_GROUP * 2; i += 1) {
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return `${out.slice(0, RECOVERY_GROUP)}-${out.slice(RECOVERY_GROUP)}`;
}

export interface TwoFactorStatus {
  /** A row exists and has been confirmed, so sign-in asks for a code. */
  enabled: boolean;
  /** Enrolment has started but no code has proved it yet. */
  pending: boolean;
  confirmedAt: Date | null;
  /** How many single-use codes are left unspent. */
  recoveryCodesLeft: number;
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const [row, recoveryCodesLeft] = await Promise.all([
    prisma.twoFactor.findUnique({ where: { userId }, select: { confirmedAt: true } }),
    prisma.recoveryCode.count({ where: { ownerId: userId, usedAt: null } }),
  ]);
  return {
    enabled: Boolean(row?.confirmedAt),
    pending: Boolean(row) && !row?.confirmedAt,
    confirmedAt: row?.confirmedAt ?? null,
    recoveryCodesLeft,
  };
}

/** Whether signing in as this account needs a second factor. */
export async function requiresTwoFactor(userId: string): Promise<boolean> {
  const row = await prisma.twoFactor.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });
  return Boolean(row?.confirmedAt);
}

/**
 * Start enrolment, returning the key to show once.
 *
 * Replaces any unconfirmed attempt, so somebody who abandoned the screen and
 * came back gets a fresh secret rather than one that has been on a screen for
 * a week. Refuses while a confirmed row exists: re-enrolling is disabling and
 * enrolling again, which the caller must ask for explicitly.
 */
export async function beginEnrolment(userId: string): Promise<string | null> {
  const existing = await prisma.twoFactor.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });
  if (existing?.confirmedAt) return null;

  const secret = generateSecret();
  await prisma.twoFactor.upsert({
    where: { userId },
    create: { userId, secret: encryptSecret(secret, "personalcrm-two-factor") },
    update: {
      secret: encryptSecret(secret, "personalcrm-two-factor"),
      confirmedAt: null,
      lastUsedStep: null,
    },
  });
  return secret;
}

async function readSecret(userId: string): Promise<{ secret: string; lastUsedStep: number | null } | null> {
  const row = await prisma.twoFactor.findUnique({
    where: { userId },
    select: { secret: true, lastUsedStep: true },
  });
  if (!row) return null;
  const secret = decryptSecret(row.secret, "personalcrm-two-factor");
  // An undecryptable secret means `AUTH_SECRET` was rotated. Failing closed is
  // the only safe answer; the recovery codes are the documented way back.
  if (!secret) return null;
  return { secret, lastUsedStep: row.lastUsedStep };
}

/**
 * Finish enrolment. Returns the recovery codes, which are shown exactly once.
 *
 * Issuing them here rather than at `beginEnrolment` is deliberate: codes handed
 * out before the authenticator was proved are codes for a factor that may never
 * have worked.
 */
export async function confirmEnrolment(
  userId: string,
  code: string,
  at: Date = new Date(),
): Promise<string[] | null> {
  const stored = await readSecret(userId);
  if (!stored) return null;

  const result = verifyTotp(stored.secret, code, { at, lastUsedStep: stored.lastUsedStep });
  if (!result.ok) return null;

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await prisma.$transaction(async (tx) => {
    await tx.twoFactor.update({
      where: { userId },
      data: { confirmedAt: at, lastUsedStep: result.step },
    });
    // Any codes from a previous enrolment belong to a secret that is gone.
    await tx.recoveryCode.deleteMany({ where: { ownerId: userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((value) => ({ ownerId: userId, codeHash: hashRecoveryCode(value) })),
    });
  });
  return codes;
}

export type SecondFactorOutcome = "ok" | "rejected" | "not-enrolled";

/**
 * Check a code at sign-in. Accepts an authenticator code or a recovery code.
 *
 * Both are checked because the person cannot be asked which they are holding
 * without telling an attacker which to try. A recovery code is spent on use.
 */
export async function verifySecondFactor(
  userId: string,
  submitted: string,
  at: Date = new Date(),
): Promise<SecondFactorOutcome> {
  const stored = await readSecret(userId);
  if (!stored) return "not-enrolled";

  const result = verifyTotp(stored.secret, submitted, { at, lastUsedStep: stored.lastUsedStep });
  if (result.ok) {
    // Recording the step is what stops the same code being used twice inside
    // its own window.
    await prisma.twoFactor.update({
      where: { userId },
      data: { lastUsedStep: result.step },
    });
    return "ok";
  }

  // `updateMany` with `usedAt: null` in the predicate, so two requests racing
  // the same code cannot both spend it: the second matches no rows.
  const spent = await prisma.recoveryCode.updateMany({
    where: { ownerId: userId, codeHash: hashRecoveryCode(submitted), usedAt: null },
    data: { usedAt: at },
  });
  return spent.count > 0 ? "ok" : "rejected";
}

/** Issue a fresh set, invalidating every code already handed out. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
  const row = await prisma.twoFactor.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });
  if (!row?.confirmedAt) return null;

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await prisma.$transaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { ownerId: userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((value) => ({ ownerId: userId, codeHash: hashRecoveryCode(value) })),
    });
  });
  return codes;
}

/** Turn it off entirely, taking the secret and every recovery code with it. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.recoveryCode.deleteMany({ where: { ownerId: userId } });
  });
}

export { RECOVERY_CODE_COUNT };
