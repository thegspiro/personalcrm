import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const MIGRATIONS = "prisma/migrations";
const NAME = "20261004120000_share_associates_and_add_notes";

/**
 * The migrations that came after this one, oldest first.
 *
 * Reaching the old shape means undoing them too, newest first, and coming back
 * means re-applying them after this one. Without that the round trip leaves
 * the database in this migration's shape rather than the latest — which every
 * suite after this one then reads as a missing column. Found when the next
 * migration added `AssociateNote.sourceInteractionId` and this suite dropped it.
 */
const LATER = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name > NAME)
  .map((entry) => entry.name)
  .sort();

/**
 * The migration that made associates shareable, run against real rows in the
 * old shape rather than asserted about as text.
 *
 * It is hand-edited — Prisma's own version drops `contactId`, `howTheyKnow`
 * and `notes` and takes every entry's friend, wording and note with it — so
 * the backfill is the part that has to be proven. The suite gets the old
 * shape by running the rollback, which proves that too, and always leaves the
 * database migrated forward for the suites after it.
 */

/** Statements in file order. Comments first, then split: a comment may hold a semicolon. */
function statements(path: string): string[] {
  return readFileSync(path, "utf8")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * One connection for the whole file: `down.sql` sets a session variable, and
 * a pooled client could run the statement that needs it somewhere else.
 */
async function runFile(path: string): Promise<void> {
  await prisma.$transaction(
    statements(path).map((statement) => prisma.$executeRawUnsafe(statement)),
  );
}

/** Back to the shape before this migration: every later one undone first, newest first. */
async function toBefore(): Promise<void> {
  for (const name of [...LATER].reverse()) await runFile(`${MIGRATIONS}/${name}/down.sql`);
  await runFile(`${MIGRATIONS}/${NAME}/down.sql`);
}

/** Forward again to the latest shape: this migration, then every later one. */
async function toLatest(): Promise<void> {
  await runFile(`${MIGRATIONS}/${NAME}/migration.sql`);
  for (const name of LATER) await runFile(`${MIGRATIONS}/${name}/migration.sql`);
}

async function hasOldShape(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Associate' AND COLUMN_NAME = 'contactId'`;
  return Number(rows[0]?.n ?? 0) > 0;
}

describe.skipIf(!hasTestDatabase)("sharing associates: the migration", () => {
  beforeEach(reset);

  afterAll(async () => {
    // Whatever happened above, the suites after this one need the new shape.
    if (await hasOldShape()) {
      await prisma.$executeRawUnsafe("DELETE FROM `Associate`");
      await toLatest();
    }
    await prisma.$disconnect();
  });

  it("moves every entry's friend, wording and note into the new tables", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const [alice, carol, zed] = await Promise.all([
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Alice" } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Carol" } }),
      prisma.contact.create({ data: { ownerId: other.id, firstName: "Zed" } }),
    ]);

    await toBefore();
    expect(await hasOldShape()).toBe(true);

    await prisma.$executeRaw`
      INSERT INTO Associate (id, ownerId, contactId, name, howTheyKnow, notes, isPrivate, createdAt, updatedAt) VALUES
        ('a-bob', ${user.id}, ${alice.id}, 'Bob', 'Colleague', 'Night shifts until March', 0, '2026-01-01', '2026-01-02'),
        ('a-bob2', ${user.id}, ${carol.id}, 'Bob', 'Climbing', NULL, 0, '2026-02-01', '2026-02-01'),
        ('a-dee', ${user.id}, ${carol.id}, 'Dee', NULL, '   ', 1, '2026-02-01', '2026-02-01'),
        ('a-eve', ${other.id}, ${zed.id}, 'Eve', 'Sister', 'Likes jazz', 0, '2026-03-01', '2026-03-01')`;

    await toLatest();
    expect(await hasOldShape()).toBe(false);

    const links = await prisma.associateLink.findMany({ orderBy: { associateId: "asc" } });
    expect(links.map((link) => [link.associateId, link.ownerId, link.contactId, link.howTheyKnow])).toEqual([
      ["a-bob", user.id, alice.id, "Colleague"],
      ["a-bob2", user.id, carol.id, "Climbing"],
      ["a-dee", user.id, carol.id, null],
      ["a-eve", other.id, zed.id, "Sister"],
    ]);

    // A blank note is not a note. A real one is a detail heard from the
    // friend whose page it was written on, dated as the entry was.
    const notes = await prisma.associateNote.findMany({ orderBy: { associateId: "asc" } });
    expect(
      notes.map((note) => [note.associateId, note.kind, note.content, note.heardFromContactId, note.date]),
    ).toEqual([
      ["a-bob", "DETAIL", "Night shifts until March", alice.id, null],
      ["a-eve", "DETAIL", "Likes jazz", zed.id, null],
    ]);
    expect(notes[0]?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // Two rows that are plainly the same Bob stay two rows: guessing from a
    // name would fold different people together.
    expect(await prisma.associate.count({ where: { ownerId: user.id, name: "Bob" } })).toBe(2);
    expect((await prisma.associate.findUniqueOrThrow({ where: { id: "a-dee" } })).isPrivate).toBe(true);
  });

  it("rolls back to the first link and every note folded into one", async () => {
    const user = await createTestUser();
    const [alice, carol] = await Promise.all([
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Alice" } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Carol" } }),
    ]);
    await prisma.associate.create({
      data: {
        id: "a-bob",
        ownerId: user.id,
        name: "Bob",
        links: {
          create: [
            { contactId: alice.id, howTheyKnow: "Colleague", createdAt: new Date("2026-01-01") },
            { contactId: carol.id, howTheyKnow: "Gym", createdAt: new Date("2026-05-01") },
          ],
        },
        notes: {
          create: [
            {
              kind: "UPDATE",
              content: "Job hunting",
              date: new Date("2026-09-01"),
              precision: "MONTH",
              heardFromContactId: carol.id,
            },
            { kind: "DETAIL", content: "Night shifts", heardFromContactId: alice.id },
          ],
        },
      },
    });
    await prisma.associate.create({ data: { id: "a-nobody", ownerId: user.id, name: "Nobody" } });

    await toBefore();

    const rows = await prisma.$queryRaw<
      { id: string; contactId: string; howTheyKnow: string | null; notes: string | null }[]
    >`SELECT id, contactId, howTheyKnow, notes FROM Associate ORDER BY id`;
    expect(rows).toEqual([
      {
        id: "a-bob",
        contactId: alice.id,
        howTheyKnow: "Colleague",
        notes: "Night shifts\n\n2026-09-01: Job hunting",
      },
    ]);

    await prisma.$executeRawUnsafe("DELETE FROM `Associate`");
    await toLatest();
    expect(await hasOldShape()).toBe(false);
  });
});
