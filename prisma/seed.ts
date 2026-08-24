/**
 * Seed script.
 *
 * Safe to run on every deploy: it only backfills taxonomies for accounts that
 * predate a new default term. Demo content is opt-in via SEED_DEMO=1 and is
 * never created when real data already exists.
 */
import { PrismaClient } from "@prisma/client";
import { provisionTaxonomies } from "../src/server/taxonomy/provision";

const prisma = new PrismaClient();

async function backfillTaxonomies() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const user of users) {
    await prisma.$transaction((tx) => provisionTaxonomies(tx, user.id));
    console.log(`  taxonomies ensured for ${user.email}`);
  }
  if (users.length === 0) console.log("  no accounts yet — first-run setup will provision them");
}

async function main() {
  console.log("Seeding personalcrm…");
  await backfillTaxonomies();

  if (process.env.SEED_DEMO === "1") {
    const { seedDemoData } = await import("./seed-demo");
    await seedDemoData(prisma);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
