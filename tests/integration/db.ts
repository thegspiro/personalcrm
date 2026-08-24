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
  "InteractionParticipant",
  "DateEntry",
  "Interaction",
  "Fact",
  "ImportantDate",
  "LifeEvent",
  "Idea",
  "Task",
  "Gift",
  "Flag",
  "RomanticProfile",
  "Relationship",
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

export async function reset(): Promise<void> {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
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

export function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 86_400_000);
}

export function daysFromNow(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + n * 86_400_000);
}
