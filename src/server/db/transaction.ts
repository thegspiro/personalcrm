import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * MariaDB's `ER_CHECKREAD`: "Record has changed since last read".
 *
 * Prisma does not map this to a `PrismaClientKnownRequestError`, so there is no
 * `error.code` to read — the driver error arrives as prose inside the message of
 * a `PrismaClientUnknownRequestError`. The number is matched rather than the
 * sentence because the sentence is a server message and can be localised, while
 * the code cannot.
 */
const RECORD_CHANGED = /\bcode: 1020\b/;

export function isRecordChanged(error: unknown): boolean {
  return error instanceof Error && RECORD_CHANGED.test(error.message);
}

/** Enough to clear a contending writer, few enough to fail rather than churn. */
const ATTEMPTS = 3;

/**
 * Run `work` in a transaction, starting it again if the database throws the
 * transaction out for a row that moved underneath it.
 *
 * MariaDB 11.6.2 turned `innodb_snapshot_isolation` on by default, which makes
 * REPEATABLE READ a true snapshot: a statement that has to lock a row modified
 * since this transaction's snapshot no longer waits and then reads the newer
 * version — it raises 1020 and **rolls the whole transaction back**. Verified
 * against 11.8.3 rather than assumed: after the error `@@in_transaction` reads
 * 0, and a statement issued next commits on its own, outside any transaction and
 * unaffected by a later `ROLLBACK`.
 *
 * That is what makes catching 1020 in place the wrong answer — carrying on would
 * autocommit the rest of the save statement by statement, which is far worse
 * than failing — and restarting the only right one. It is also what the server
 * itself asks for: the full message ends "try restarting transaction".
 *
 * A restart is safe here because every caller's callback does nothing but talk
 * to `tx`: no outer state is mutated, nothing is sent anywhere, and the rolled
 * back attempt left no rows behind. The second attempt takes a fresh snapshot,
 * so it sees the value that displaced it and — for the fill-only rules in
 * `resolveLocation` — correctly declines to write over it.
 *
 * On MariaDB 10.11, which the container bundles, `innodb_snapshot_isolation`
 * does not exist, 1020 is never raised, and this is a plain `$transaction`.
 * Both are supported: an operator may point `DATABASE_URL` at either.
 */
export async function transact<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work);
    } catch (error) {
      if (attempt >= ATTEMPTS || !isRecordChanged(error)) throw error;
    }
  }
}
