import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret } from "@/server/crypto/secrets";

/**
 * The credential behind a calendar subscription URL.
 *
 * Two representations of one token, for two different questions. The sha256
 * hash answers "is this URL valid" in a single indexed lookup on every poll —
 * a calendar client fetches unattended and often, so this cannot be a slow
 * password hash. The ciphertext answers "show me my URL again", which a
 * subscription genuinely needs: it has to reach a phone, a laptop and a web
 * calendar, and a show-once secret would have people regenerating it and
 * breaking the subscriptions they already made.
 *
 * The token grants strictly less than a locked browser session: read-only, and
 * only the calendar entries a closed privacy lock already permits.
 */

/** 32 random bytes, URL-safe, so the whole thing can live in a path segment. */
const TOKEN_BYTES = 32;

/**
 * How stale `lastAccessedAt` may get before a fetch bothers to write.
 *
 * Clients poll on their own schedule — Google every few hours, some clients
 * every few minutes — and this is the difference between a read endpoint and
 * one that writes a row on every request.
 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface FeedStatus {
  createdAt: Date;
  lastAccessedAt: Date | null;
  /**
   * The token itself, or null when it cannot be decrypted — which means
   * `AUTH_SECRET` was rotated since it was issued. The feed still works, since
   * the route resolves against the hash; only redisplay is lost, and the
   * answer is to regenerate.
   */
  token: string | null;
}

/** The account's feed, without minting one. */
export async function getFeedStatus(ownerId: string): Promise<FeedStatus | null> {
  const row = await prisma.calendarFeed.findUnique({
    where: { ownerId },
    select: { token: true, createdAt: true, lastAccessedAt: true },
  });
  if (!row) return null;
  return {
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt,
    token: decryptSecret(row.token, "personalcrm-calendar-feed"),
  };
}

/**
 * Mint a token, replacing any that exists.
 *
 * An upsert on the unique `ownerId` rather than a delete and a create: the
 * account has one feed by construction, and doing it in one statement means
 * two clicks racing cannot leave the account with none.
 */
export async function issueFeedToken(ownerId: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashFeedToken(token);
  const encrypted = encryptSecret(token, "personalcrm-calendar-feed");

  await prisma.calendarFeed.upsert({
    where: { ownerId },
    create: { ownerId, tokenHash, token: encrypted },
    // A new token means a new subscription: the old URL stops working and the
    // access record belongs to the token that earned it, so it is cleared.
    update: { tokenHash, token: encrypted, lastAccessedAt: null, createdAt: new Date() },
  });

  return token;
}

export async function revokeFeed(ownerId: string): Promise<void> {
  await prisma.calendarFeed.deleteMany({ where: { ownerId } });
}

export interface ResolvedFeed {
  ownerId: string;
  timezone: string;
}

/**
 * Who a presented token belongs to, or null.
 *
 * Null for every refusal alike — a token this server never issued, one that
 * has been regenerated, an account since deleted — because the route answers
 * `404` to all of them and distinguishing them would confirm which URLs once
 * existed.
 *
 * The timezone comes back with the owner because every date in the feed has to
 * be anchored to the account's zone rather than the server clock, and this is
 * the one place that already has the row.
 */
export async function resolveFeed(token: string): Promise<ResolvedFeed | null> {
  // Length-checked before hashing so a pathological path segment is refused
  // without work. base64url of 32 bytes is 43 characters.
  if (!token || token.length < 16 || token.length > 128) return null;

  const row = await prisma.calendarFeed.findUnique({
    where: { tokenHash: hashFeedToken(token) },
    select: {
      id: true,
      ownerId: true,
      lastAccessedAt: true,
      owner: { select: { isActive: true, preference: { select: { timezone: true } } } },
    },
  });
  if (!row) return null;
  // A deactivated account stops serving, the same as it stops signing in.
  if (!row.owner.isActive) return null;

  await touch(row.id, row.lastAccessedAt);

  return {
    ownerId: row.ownerId,
    // The same fallback `getUserContext` uses when it creates the row, so a
    // feed for an account that has never loaded a page still anchors its days
    // to the zone the app would have chosen — invariant 2. Reaching this at all
    // means no preference row exists yet.
    timezone: row.owner.preference?.timezone ?? process.env.TZ ?? "America/New_York",
  };
}

async function touch(id: string, lastAccessedAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastAccessedAt && now - lastAccessedAt.getTime() < TOUCH_INTERVAL_MS) return;
  try {
    await prisma.calendarFeed.update({ where: { id }, data: { lastAccessedAt: new Date() } });
  } catch {
    // Recording the visit is a convenience for the Settings page. A feed that
    // refused to serve because it could not write a timestamp would be a
    // worse trade than a timestamp that is occasionally stale.
  }
}
