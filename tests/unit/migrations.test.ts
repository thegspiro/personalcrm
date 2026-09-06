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

  it("repairs what the same-owner key would refuse, not merely what disagrees", () => {
    const sql = readFileSync(
      join(migrationsRoot, "20260904120000_same_owner_contact_keys", "migration.sql"),
      "utf8",
    );

    // A restore with foreign-key checks off is the case this migration exists
    // for, and it can leave a `contactId` pointing at no row at all. Asking
    // "do the two owners disagree" is a join, and a join skips that row — so
    // it survived the repair and then `ADD CONSTRAINT` aborted the upgrade on
    // exactly the installation that needed it. Every repair asks the
    // constraint's own question instead.
    expect(sql).not.toMatch(/`c`\.`ownerId` <> /);
    for (const table of [
      "Relationship", "Fact", "ImportantDate", "LifeEvent",
      "FamilySuggestionDismissal", "Happening", "Gift", "Debt", "DietaryNeed",
      "RomanticProfile", "DateEntry", "Flag",
    ]) {
      expect(sql, `${table} is repaired by a delete`).toContain(
        `DELETE \`x\` FROM \`${table}\` \`x\` WHERE NOT EXISTS`,
      );
    }
    for (const table of ["Idea", "Task", "Plan"]) {
      expect(sql, `${table} keeps its text and loses only the link`).toMatch(
        new RegExp(`UPDATE \`${table}\` \`x\` SET \`x\`\\.\`contactId\` = NULL`),
      );
    }

    // The owner is copied from the parent, so a join row whose parent is gone
    // keeps a NULL one — and `MODIFY ... NOT NULL` refuses it. Those rows have
    // to go first.
    for (const [table, parent] of [
      ["InteractionParticipant", "Interaction"],
      ["InteractionMention", "Interaction"],
      ["LifeEventParticipant", "LifeEvent"],
      ["HouseholdMember", "Household"],
    ]) {
      const orphans = sql.indexOf(
        `DELETE \`j\` FROM \`${table}\` \`j\` WHERE NOT EXISTS (\n    SELECT 1 FROM \`${parent}\``,
      );
      const notNull = sql.indexOf(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`ownerId\` VARCHAR(191) NOT NULL`,
      );
      expect(orphans, `${table} sweeps rows whose ${parent} is gone`).toBeGreaterThan(-1);
      expect(notNull).toBeGreaterThan(orphans);
    }
  });

  it("adds coordinates and a home base without touching anything already there", () => {
    const sql = readFileSync(
      join(
        migrationsRoot,
        "20260905120000_add_address_coordinates_and_home_base",
        "migration.sql",
      ),
      "utf8",
    );

    // Purely additive by construction. An installation upgrading through this
    // keeps every address it has and reads exactly as it did before, so there
    // is nothing to backfill and nothing that can be lost.
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);

    for (const column of ["latitude", "longitude", "osmType", "osmId"]) {
      expect(sql, `Address gains ${column}`).toContain(`ADD COLUMN \`${column}\``);
    }
    for (const column of [
      "homeAddress",
      "homeCity",
      "homeRegion",
      "homeCountry",
      "homeLatitude",
      "homeLongitude",
      "distanceUnit",
    ]) {
      expect(sql, `UserPreference gains ${column}`).toContain(`ADD COLUMN \`${column}\``);
    }

    // Coordinates match `Location` exactly, so one reader serves every table
    // that holds a point; `osmId` is a BIGINT because OSM ids are past 2^32.
    expect(sql).toContain("`latitude` DECIMAL(10,7) NULL");
    expect(sql).toContain("`osmId` BIGINT NULL");
    // The one non-null addition needs a default, or the ALTER fails on any row
    // that already exists.
    expect(sql).toContain("`distanceUnit` VARCHAR(8) NOT NULL DEFAULT 'mi'");
  });

  it("backfills only unambiguous aliases and preserves the legacy JSON", () => {
    const sql = readFileSync(
      join(migrationsRoot, "20260903000000_add_location_aliases", "migration.sql"),
      "utf8",
    );
    expect(sql).toContain("COUNT(DISTINCT l2.`id`)");
    expect(sql).toContain("JSON_TABLE");
    expect(sql).not.toMatch(/DROP COLUMN `aliases`/);
    expect(sql).toContain("UNIQUE INDEX `LocationAlias_ownerId_normalizedValue_key`");
  });
});
