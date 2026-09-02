import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { reminderDedupKey } from "@/lib/reminder-schedule";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const MIGRATION = "prisma/migrations/20260902120000_add_reminder_policy_and_dedup_key/migration.sql";

/**
 * The migration's backfill has to produce the very key the application
 * computes, not merely a unique one: the scheduler looks rows up by it before
 * inserting, so a pre-upgrade row keyed any other way is invisible to it and,
 * once cancelled, blocked for ever by the delivery key it still carries. The
 * UPDATE is read out of the migration file itself and run against a real
 * row, so the two cannot drift apart unnoticed.
 */
describe.skipIf(!hasTestDatabase)("reminder key backfill", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("backfills exactly the key the scheduler will look for", async () => {
    const user = await createTestUser();
    const channel = await prisma.notificationChannel.create({
      data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } },
    });
    const row = await prisma.reminderLog.create({
      data: {
        ownerId: user.id,
        entityType: "IMPORTANT_DATE",
        entityId: "cmimportantdate0000000000",
        schedulingPolicy: "IMPORTANT_DATE_OFFSET",
        dedupKey: "not-yet-backfilled",
        scheduledFor: new Date("2026-09-14T00:00:00Z"),
        offsetDays: 7,
        channelId: channel.id,
      },
    });

    // Comments first, then statements: a comment may hold a semicolon.
    const statements = readFileSync(MIGRATION, "utf8")
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith("UPDATE"));
    expect(statements).toHaveLength(2);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    const backfilled = await prisma.reminderLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(backfilled.dedupKey).toBe(reminderDedupKey({
      ownerId: user.id,
      entityType: "IMPORTANT_DATE",
      entityId: "cmimportantdate0000000000",
      policy: "IMPORTANT_DATE_OFFSET",
      occurrence: "2026-09-14",
      offsetDays: 7,
      channelId: channel.id,
    }));
  });
});
