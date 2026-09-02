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

  it("backfills places within an owner and keeps the text each row was written with", () => {
    const sql = readFileSync(
      join(migrationsRoot, "20260831120000_add_locations", "migration.sql"),
      "utf8",
    );

    // Two accounts may both have a "Corner Cafe". Joining on normalizedName
    // alone would point one owner's history at the other's place.
    expect(sql).toContain("l.`ownerId` = i.`ownerId`");
    expect(sql).toContain("l.`ownerId` = p.`ownerId`");

    // The canonical id is additive: the free-text column stays, so the upgrade
    // is lossless even when two historical spellings are later merged.
    expect(sql).toContain("ADD COLUMN `locationId`");
    expect(sql).not.toMatch(/DROP COLUMN `location`/);
  });

  it("backfills only unambiguous aliases and preserves the legacy JSON", () => {
    const sql = readFileSync(
      join(migrationsRoot, "20260902120000_add_location_aliases", "migration.sql"),
      "utf8",
    );
    expect(sql).toContain("COUNT(DISTINCT l2.`id`)");
    expect(sql).toContain("JSON_TABLE");
    expect(sql).not.toMatch(/DROP COLUMN `aliases`/);
    expect(sql).toContain("UNIQUE INDEX `LocationAlias_ownerId_normalizedValue_key`");
  });
});
