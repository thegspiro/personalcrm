import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

/**
 * How many rows in the account are marked private, across every model that
 * carries the marker.
 *
 * Lives apart from `offline.ts` — without `server-only`, and taking its client
 * rather than importing one, following the services — so it can be tested
 * against a real database. `offlineCacheable` reads the live request's lock
 * state and cannot run outside a request, which is how the gap this closes went
 * unnoticed in the first place.
 *
 * Every model that gains an `isPrivate` column has to be added here. The cost
 * of forgetting is silent: offline caching stays switched on and the private
 * row is written to disk by the service worker.
 */
export async function countPrivateRows(db: Db, ownerId: string): Promise<number> {
  const counts = await Promise.all([
    db.contact.count({ where: { ownerId, isPrivate: true } }),
    db.fact.count({ where: { ownerId, isPrivate: true } }),
    db.interaction.count({ where: { ownerId, isPrivate: true } }),
    db.debt.count({ where: { ownerId, isPrivate: true } }),
  ]);

  return counts.reduce((total, count) => total + count, 0);
}
