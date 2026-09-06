/**
 * Empties the end-to-end database so the suite's `first-run` project has no
 * account to collide with.
 *
 * Truncates rather than dropping, for two reasons. It is narrower — the schema
 * and the applied-migration history both survive, so this cannot be pointed at
 * something it would take a migration run to rebuild. And it is the same shape
 * as `reset()` in tests/integration/db.ts, which the integration suites have
 * used between runs since the beginning.
 *
 * The table list comes from information_schema rather than a constant, so a new
 * table is swept the moment it exists. `_prisma_migrations` is left alone:
 * emptying it would make `migrate deploy` try to create tables that are already
 * there.
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("reset-db: DATABASE_URL is not set.");
  process.exit(1);
}

// The same guard tests/integration/db.ts applies, for the same reason: this
// truncates every table it finds, so the name has to say it is disposable.
const schema = decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
if (!schema.endsWith("_e2e")) {
  console.error(
    `reset-db: refusing to truncate "${schema}" — the database name must end in "_e2e".`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } }, log: ["error"] });

try {
  const rows = await prisma.$queryRaw`
    SELECT TABLE_NAME AS name
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${schema} AND TABLE_TYPE = 'BASE TABLE'
  `;
  const tables = rows
    .map((row) => row.name)
    .filter((name) => name !== "_prisma_migrations");

  if (tables.length === 0) {
    console.log(`reset-db: ${schema} has no tables yet; nothing to truncate.`);
  } else {
    // One $transaction, not a loop of awaits: FOREIGN_KEY_CHECKS is a session
    // variable, and separate Prisma calls can land on different pooled
    // connections — so the truncates would run with checks still enabled and
    // the first referenced table would abort. reset() in
    // tests/integration/db.ts pins the same sequence to one connection the
    // same way.
    //
    // Identifiers cannot be bound as parameters. Every name here came from
    // information_schema for this schema, and is backquote-escaped.
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0"),
      ...tables.map((table) =>
        prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table.replace(/`/g, "``")}\``),
      ),
      prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1"),
    ]);
    console.log(`reset-db: emptied ${tables.length} table(s) in ${schema}.`);
  }
} finally {
  await prisma.$disconnect();
}
