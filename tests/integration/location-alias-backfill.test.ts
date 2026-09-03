import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const MIGRATION = "prisma/migrations/20260903000000_add_location_aliases/migration.sql";

/**
 * The backfill is run here against real rows rather than asserted about as
 * text. Reading it was not enough once already: every string JSON_TABLE hands
 * back carries the database's default collation, the tables carry
 * utf8mb4_unicode_ci, and comparing the two aborts the migration — on the
 * installations whose default differs, and only there, which is exactly the
 * kind of failure a text assertion cannot see.
 */
describe.skipIf(!hasTestDatabase)("location alias backfill", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  async function runBackfill() {
    // Comments first, then statements: a comment may hold a semicolon.
    const statements = readFileSync(MIGRATION, "utf8")
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith("INSERT"));
    expect(statements).toHaveLength(2);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }

  it("claims every canonical name and only the aliases that name one place", async () => {
    const user = await createTestUser();
    const other = await createTestUser();

    const cafe = await prisma.location.create({
      data: {
        ownerId: user.id,
        name: "Corner Cafe",
        normalizedName: "corner cafe",
        aliases: ["The Corner", "  Spaced   Out  ", ""],
      },
    });
    const bar = await prisma.location.create({
      data: {
        ownerId: user.id,
        name: "Night Owl",
        normalizedName: "night owl",
        // "The Corner" is claimed by the cafe too, and "Corner Cafe" is
        // already a canonical name. Neither may be guessed onto this row.
        aliases: ["The Corner", "Corner Cafe", "Owl Bar"],
      },
    });
    // Another account using the same words must not collide with either.
    const theirs = await prisma.location.create({
      data: {
        ownerId: other.id,
        name: "Corner Cafe",
        normalizedName: "corner cafe",
        aliases: ["The Corner"],
      },
    });

    await runBackfill();

    const rows = await prisma.locationAlias.findMany({
      orderBy: [{ ownerId: "asc" }, { normalizedValue: "asc" }],
      select: { ownerId: true, locationId: true, value: true, normalizedValue: true, isCanonical: true },
    });

    // Every canonical name claims its own identity, in both accounts.
    expect(rows.filter((row) => row.isCanonical)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId: cafe.id, normalizedValue: "corner cafe", isCanonical: true }),
        expect.objectContaining({ locationId: bar.id, normalizedValue: "night owl", isCanonical: true }),
        expect.objectContaining({ locationId: theirs.id, normalizedValue: "corner cafe", isCanonical: true }),
      ]),
    );

    const mine = rows.filter((row) => row.ownerId === user.id && !row.isCanonical);
    // "Owl Bar" names one place; the run-together spacing is normalised but
    // the text the row was written with is kept.
    expect(mine.map((row) => row.normalizedValue).sort()).toEqual(["owl bar", "spaced out"]);
    expect(mine.find((row) => row.normalizedValue === "spaced out")?.value).toBe("Spaced   Out");

    // Ambiguous between two places, and a collision with a canonical name:
    // both stay in Location.aliases rather than being pointed at a guess.
    expect(mine.some((row) => row.normalizedValue === "the corner")).toBe(false);
    expect(rows.filter((row) => row.normalizedValue === "corner cafe" && row.ownerId === user.id)).toHaveLength(1);

    // The other account's identical alias is unaffected by ours.
    expect(
      rows.filter((row) => row.ownerId === other.id && row.normalizedValue === "the corner"),
    ).toHaveLength(1);

    // Nothing is destroyed: the legacy column still holds what it held.
    const kept = await prisma.location.findUniqueOrThrow({ where: { id: bar.id }, select: { aliases: true } });
    expect(kept.aliases).toEqual(["The Corner", "Corner Cafe", "Owl Bar"]);
  });
});
