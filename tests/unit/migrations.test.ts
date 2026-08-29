import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsRoot = join(process.cwd(), "prisma", "migrations");

describe("MariaDB migrations", () => {
  it("keeps explicitly named indexes and constraints within MariaDB's identifier limit", () => {
    const identifiers: { migration: string; name: string }[] = [];
    for (const migration of readdirSync(migrationsRoot)) {
      const path = join(migrationsRoot, migration, "migration.sql");
      let sql: string;
      try {
        sql = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const match of sql.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/gi)) {
        identifiers.push({ migration, name: match[1] });
      }
    }

    const tooLong = identifiers.filter(({ name }) => Buffer.byteLength(name, "utf8") > 64);
    expect(tooLong, `MariaDB limits identifiers to 64 bytes: ${JSON.stringify(tooLong)}`).toEqual([]);
  });
});
