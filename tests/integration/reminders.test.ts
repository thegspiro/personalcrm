import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processImportantDateReminders } from "@/server/services/reminders";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

describe.skipIf(!hasTestDatabase)("important-date delivery", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("creates one idempotent delivery and excludes archived and locked-private contacts", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "America/Los_Angeles", privacyLockEnabled: true } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contacts = await Promise.all([
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Visible" } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Archived", isArchived: true } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Private", isPrivate: true } }),
    ]);
    for (const contact of contacts) {
      await prisma.importantDate.create({ data: {
        ownerId: user.id,
        contactId: contact.id,
        label: "Birthday",
        date: new Date("2000-08-29T00:00:00Z"),
        recurrence: "ANNUAL",
        reminderDaysBefore: [0],
      } });
    }
    const send = vi.fn(async () => undefined);
    // Still Aug 28 in Los Angeles; nothing is due at this UTC boundary.
    await processImportantDateReminders(new Date("2026-08-29T01:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();

    const now = new Date("2026-08-29T18:00:00Z");
    await processImportantDateReminders(now, { db: prisma, send });
    await processImportantDateReminders(now, { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 1, offsetDays: 0 });
  });

  it("retries failures without creating a duplicate ledger row", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC" } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Sam" } });
    await prisma.importantDate.create({ data: { ownerId: user.id, contactId: contact.id, label: "Date", date: new Date("2026-08-29T00:00:00Z"), recurrence: "NONE", reminderDaysBefore: [0] } });
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const first = new Date("2026-08-29T12:00:00Z");
    await processImportantDateReminders(first, { db: prisma, send });
    await processImportantDateReminders(new Date(first.getTime() + 61_000), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 2 });
  });
});
