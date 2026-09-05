import { PrismaClient } from "@prisma/client";
import { provisionTaxonomies } from "@/server/taxonomy/provision";

/**
 * Integration-test database.
 *
 * Points at TEST_DATABASE_URL, which must be a throwaway database — `reset()`
 * truncates every table. Guarded so a misconfigured environment can't wipe real
 * data: the URL has to name a database ending in `_test`.
 */
const url = process.env.TEST_DATABASE_URL;

export const hasTestDatabase = Boolean(url);

if (url && !/_test(\?|$)/.test(url)) {
  throw new Error(
    `TEST_DATABASE_URL must point at a database whose name ends in "_test" — got ${url}`,
  );
}

export const prisma = new PrismaClient({
  datasources: { db: { url: url ?? "mysql://invalid" } },
  log: ["error"],
});

/** Order matters only in that foreign key checks are off while we truncate. */
const TABLES = [
  "InteractionMention",
  "InteractionParticipant",
  "Plan",
  "DateEntry",
  "Interaction",
  "LocationAlias",
  "Location",
  "Fact",
  "Associate",
  "ImportantDate",
  "LifeEventParticipant",
  "LifeEvent",
  "Idea",
  "Happening",
  "Task",
  "Gift",
  "Debt",
  "DietaryNeed",
  "Flag",
  "RomanticProfile",
  "Relationship",
  "HouseholdMember",
  "Household",
  "FamilySuggestionDismissal",
  "ContactTag",
  "ContactMethod",
  "Address",
  "Contact",
  "Tag",
  "CustomFieldValue",
  "CustomFieldDefinition",
  "ReminderLog",
  "NotificationChannel",
  "DashboardLayout",
  "TaxonomyTerm",
  "UserPreference",
  "Session",
  "User",
  "AppSetting",
];

/**
 * Truncate everything.
 *
 * Batched through `$transaction` so all of it runs on one connection:
 * FOREIGN_KEY_CHECKS is a session variable, and with a pool the disable and
 * the truncates can otherwise land on different connections — which fails the
 * moment two tables reference each other.
 */
export async function reset(): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0"),
    ...TABLES.map((table) =>
      prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``),
    ),
    prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1"),
  ]);
}

let counter = 0;

/** A user with the starter taxonomies, ready to hang contacts off. */
export async function createTestUser() {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `test-${counter}-${Date.now()}@example.com`,
      name: "Test User",
      passwordHash: "not-a-real-hash",
      role: "ADMIN",
    },
  });
  await prisma.$transaction((tx) => provisionTaxonomies(tx, user.id));
  return user;
}

/**
 * Write rows the schema forbids, the way a restore does.
 *
 * Every foreign key into `Contact`, `Tag` and `Location` names `(ownerId, id)`,
 * so the database refuses a row that spans two accounts and the application
 * cannot make one. That is
 * not the same as making the readers' owner predicates dead code:
 * `mariadb-dump` emits `SET FOREIGN_KEY_CHECKS=0`, so restoring a dump taken
 * before those keys existed — the documented recovery path — can still bring
 * such a row in. The checks that use this are what keep the readers honest
 * about it.
 *
 * One interactive transaction, because the setting is per-connection and the
 * client pools: split across two calls it can land on a connection that never
 * saw it.
 */
export async function asARestoreWould<T>(
  write: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
    try {
      return await write(tx);
    } finally {
      await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
    }
  });
}

export function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 86_400_000);
}

export function daysFromNow(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + n * 86_400_000);
}
