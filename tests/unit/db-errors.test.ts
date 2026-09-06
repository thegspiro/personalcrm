import { describe, expect, it } from "vitest";
import { isConcurrentRowChange } from "@/lib/db-errors";

describe("isConcurrentRowChange", () => {
  it("recognises the error MariaDB 11 raises when another writer got there first", () => {
    // Verbatim from the CI run that caught this: the promote transaction's
    // claiming updateMany, refused because a racing request had already
    // changed the row. MariaDB 10 reports nought rows matched instead, which
    // is why this went unseen locally.
    const error = new Error(
      "\nInvalid `tx.associate.updateMany()` invocation\n\n" +
        "Error occurred during query execution:\n" +
        "ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Server(" +
        "MysqlError { code: 1020, message: \"Record has changed since last read in table " +
        "'Associate'; try restarting transaction\", state: \"HY000\" })), transient: false })",
    );

    expect(isConcurrentRowChange(error)).toBe(true);
  });

  it("recognises the bare server message on its own", () => {
    expect(
      isConcurrentRowChange(new Error("Record has changed since last read in table 'Associate'")),
    ).toBe(true);
  });

  it("does not claim an unrelated database error", () => {
    // Losing a race is recoverable; a constraint violation is not, and must
    // keep propagating rather than being answered with someone else's row.
    expect(
      isConcurrentRowChange(new Error("Unique constraint failed on the constraint: `User_email_key`")),
    ).toBe(false);
  });

  it("does not throw on a non-error value", () => {
    expect(isConcurrentRowChange(undefined)).toBe(false);
    expect(isConcurrentRowChange("Record has changed since last read")).toBe(false);
  });
});
