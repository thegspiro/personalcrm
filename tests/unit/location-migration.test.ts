import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("location migration", () => {
  it("backfills through owner-scoped joins and retains legacy text", () => {
    const sql = readFileSync("prisma/migrations/20260831120000_add_location_history/migration.sql", "utf8");
    expect(sql).toContain("location.`ownerId` = interaction.`ownerId`");
    expect(sql).toContain("ADD COLUMN `locationId`");
    expect(sql).not.toMatch(/DROP COLUMN `location`/);
  });
});
