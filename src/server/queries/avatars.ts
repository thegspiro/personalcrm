import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { IDLE_TIMEOUT_MS } from "@/server/privacy/lock";

/**
 * The one lookup an avatar request needs beyond its session.
 *
 * A People page renders up to two hundred avatars, and each is its own HTTP
 * request. Resolving the lock the way a page does — user context, then the
 * preference row, then the session row again, then the contact — would turn
 * one page load into the better part of a thousand queries. So the lock is
 * folded into the contact query: the row is visible if it is not private, or
 * if the owner has no PIN, or the lock is switched off, or this very session
 * opened it within the idle timeout. That is `getPrivacyState` restated as a
 * where-clause, with one deliberate difference: an owner with a PIN but no
 * preference row at all (a partial import) is treated as locked rather than
 * having a row created for them mid-request.
 */
export async function findVisibleAvatarContact(
  db: PrismaClient | Prisma.TransactionClient,
  args: {
    ownerId: string;
    publicPath: string;
    /** The hash the session row is keyed by, or null for no cookie. */
    sessionTokenHash: string | null;
    now?: Date;
  },
): Promise<{ id: string } | null> {
  const now = args.now ?? new Date();
  const unlockedBy: Prisma.ContactWhereInput[] = args.sessionTokenHash
    ? [{
        owner: {
          sessions: {
            some: {
              tokenHash: args.sessionTokenHash,
              // The same closed boundary as isUnlockActive.
              privacyUnlockedAt: { gt: new Date(now.getTime() - IDLE_TIMEOUT_MS), lte: now },
            },
          },
        },
      }]
    : [];
  return db.contact.findFirst({
    where: {
      ownerId: args.ownerId,
      avatarPath: args.publicPath,
      OR: [
        { isPrivate: false },
        { owner: { privacyPinHash: null } },
        { owner: { preference: { privacyLockEnabled: false } } },
        ...unlockedBy,
      ],
    },
    select: { id: true },
  });
}
