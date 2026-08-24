import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db/client";
import { privacyScope } from "./filter";

/**
 * Whether this account's pages may be kept for offline reading.
 *
 * Caching is off by default and a page has to ask, so the question is only
 * ever "is it safe to ask". It is safe in exactly two situations:
 *
 *  1. **The lock is on and closed.** Every query has already excluded private
 *     rows by construction, so the page provably contains none. What ends up
 *     on disk is exactly what someone holding your unlocked phone could see
 *     anyway.
 *  2. **There is nothing private to leak.** No private contacts, facts or
 *     interactions anywhere in the account — the common case for someone who
 *     has never used the marker.
 *
 * Anything else — unlocked, or the lock switched off while private rows exist
 * — means a page could carry something you deliberately hid, and none of it
 * gets stored. A stale copy is an inconvenience; a private note written to
 * disk is the thing the lock exists to prevent.
 *
 * Memoised per request: three counts, asked once.
 */
export const offlineCacheable = cache(async (ownerId: string): Promise<boolean> => {
  const scope = await privacyScope();
  if (scope.enabled && !scope.unlocked) return true;

  const [contacts, facts, interactions] = await Promise.all([
    prisma.contact.count({ where: { ownerId, isPrivate: true } }),
    prisma.fact.count({ where: { ownerId, isPrivate: true } }),
    prisma.interaction.count({ where: { ownerId, isPrivate: true } }),
  ]);

  return contacts === 0 && facts === 0 && interactions === 0;
});
