/**
 * Reading what the database meant, from the error it raised.
 *
 * Kept structural — matching on the message rather than on a Prisma error
 * class — because a driver-level failure reaches the client as
 * `PrismaClientUnknownRequestError`, which carries no `code` to branch on. It
 * also keeps this module free of Prisma, so it can be unit tested against the
 * exact string a server produced rather than against a mock.
 */

/**
 * Whether the error means another transaction changed the row first.
 *
 * MariaDB 11 raises 1020 (`ER_CHECKREAD`, "Record has changed since last
 * read") when an `UPDATE` inside a transaction finds a row that has moved on
 * since that transaction's read snapshot — which is what a second, racing
 * writer looks like from inside the first. **MariaDB 10 does not**: it reports
 * nought rows matched instead, so the same race takes a completely different
 * branch depending on the server version.
 *
 * Both are the same event, so both callers must handle it the same way, and
 * neither is a reason to fail: re-read the row and let its committed state
 * decide the answer.
 */
export function isConcurrentRowChange(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Record has changed since last read") || message.includes("code: 1020")
  );
}
