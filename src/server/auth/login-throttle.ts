import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  ATTEMPT_TTL_MS,
  backoffRemainingMs,
  describeWait,
  isStale,
} from "@/lib/login-throttle";

/**
 * The durable half of sign-in throttling.
 *
 * Two things decide the shape of this file.
 *
 * The attempt is counted *before* the password is checked, not after. Counting
 * afterwards leaves a window in which every request in a burst reads the same
 * count, passes the gate together, and only then increments — so a hundred
 * concurrent guesses all get a free try. Counting first means each request
 * serialises on the row and sees a distinct number.
 *
 * The counting transaction never contains the bcrypt call. Verifying a
 * password takes a quarter of a second at this cost factor, and holding a
 * locked row across it would turn every sign-in into a queue.
 */

export interface ThrottleDecision {
  /** The attempt must be refused without checking the password. */
  blocked: boolean;
  /** Seconds until another attempt is allowed. Zero unless blocked. */
  retryAfterSeconds: number;
  /** Ready-to-render sentence, or null when not blocked. */
  message: string | null;
}

const ALLOWED: ThrottleDecision = { blocked: false, retryAfterSeconds: 0, message: null };

function refuse(remainingMs: number): ThrottleDecision {
  return {
    blocked: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    // Says nothing about whether the address has an account behind it: the
    // same sentence is produced for an address that has never existed.
    message: `Too many sign-in attempts. Try again in ${describeWait(remainingMs)}.`,
  };
}

/** The key an attempt is counted under. `ip` is normalised, never null. */
export function attemptKey(email: string, ip: string | null | undefined) {
  return { email: email.trim().toLowerCase().slice(0, 191), ip: (ip ?? "").slice(0, 64) };
}

/**
 * Record that a sign-in is being attempted, and say whether it may proceed.
 *
 * Call this before verifying the password. A refusal carries the wait; an
 * allowed attempt has already been counted, so a caller that succeeds must
 * follow up with `clearLoginAttempts`.
 */
export async function registerLoginAttempt(
  email: string,
  ip: string | null | undefined,
  now: Date = new Date(),
  db: typeof prisma = prisma,
): Promise<ThrottleDecision> {
  const key = attemptKey(email, ip);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; failedCount: number; failedAt: Date }>
    >`SELECT id, failedCount, failedAt
        FROM \`LoginAttempt\`
       WHERE email = ${key.email} AND ip = ${key.ip}
       FOR UPDATE`;
    const existing = rows[0];

    if (!existing) {
      try {
        await tx.loginAttempt.create({
          data: { email: key.email, ip: key.ip, failedCount: 1, failedAt: now },
        });
      } catch (error) {
        // Another request inserted this pair between the SELECT and here. The
        // row lock above covers an existing row; a row that does not exist yet
        // is only protected by the unique key, so the collision is caught
        // rather than prevented. Their attempt is on the record — add ours to
        // it instead of losing the count to a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          await tx.loginAttempt.updateMany({
            where: { email: key.email, ip: key.ip },
            data: { failedCount: { increment: 1 }, failedAt: now },
          });
        } else {
          throw error;
        }
      }
      return ALLOWED;
    }

    // Old enough that the earlier failures say nothing about this one.
    if (isStale(existing.failedAt, now.getTime())) {
      await tx.loginAttempt.update({
        where: { id: existing.id },
        data: { failedCount: 1, failedAt: now },
      });
      return ALLOWED;
    }

    const remainingMs = backoffRemainingMs(
      existing.failedCount,
      existing.failedAt,
      now.getTime(),
    );
    if (remainingMs > 0) {
      // Deliberately not incremented. Someone already waiting should be able
      // to wait the stated time out; extending it on every refused attempt
      // would mean an impatient person never gets back in.
      return refuse(remainingMs);
    }

    await tx.loginAttempt.update({
      where: { id: existing.id },
      data: { failedCount: existing.failedCount + 1, failedAt: now },
    });
    return ALLOWED;
  });
}

/**
 * Forget the attempts for one address from one client. Called on a successful
 * sign-in, so a person who mistyped four times starts clean once they get in.
 */
export async function clearLoginAttempts(
  email: string,
  ip: string | null | undefined,
  db: typeof prisma = prisma,
): Promise<void> {
  const key = attemptKey(email, ip);
  await db.loginAttempt.deleteMany({ where: { email: key.email, ip: key.ip } });
}

/**
 * Drop attempt rows past the retention window. Housekeeping only — a stale row
 * never blocks anyone, it is just a row nobody will read again.
 */
export async function purgeStaleLoginAttempts(
  now: Date = new Date(),
  db: typeof prisma = prisma,
): Promise<number> {
  const { count } = await db.loginAttempt.deleteMany({
    where: { failedAt: { lt: new Date(now.getTime() - ATTEMPT_TTL_MS) } },
  });
  return count;
}
