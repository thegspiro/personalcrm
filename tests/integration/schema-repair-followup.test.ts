import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("@/server/reminder-scheduler", () => ({ startReminderScheduler: () => {} }));

const { finishSchemaRepairs } = await import("@/server/startup");

const KEY = "schemaRepair.sameOwnerContactKeys.derived";

/**
 * The half of the same-owner repair a migration is not allowed to do.
 *
 * `Contact.lastInteractionAt` / `nextTouchAt` and `DateEntry.sequence` are
 * derived, with one writer each in application code. Removing a participant or
 * a date changes what they derive from, so the migration records the people and
 * this runs the real services over them at the next boot. Asserted against real
 * rows rather than read as text: what matters is that the numbers come out
 * right, not that the call is present.
 */
describe.skipIf(!hasTestDatabase)("schema repair follow-up", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  async function interactionAt(ownerId: string, occurredAt: Date, contactId?: string) {
    return prisma.interaction.create({
      data: {
        ownerId,
        occurredAt,
        // `ownerId` comes from the interaction through the composite key.
        ...(contactId ? { participants: { create: [{ contactId }] } } : {}),
      },
    });
  }

  it("recomputes last contact from what is left, and renumbers the dates", async () => {
    const owner = await createTestUser();
    const contact = await prisma.contact.create({
      data: {
        ownerId: owner.id,
        firstName: "Dana",
        cadenceDays: 30,
        // The state the migration leaves behind: a last-contact date carried
        // over from an interaction this person is no longer part of. Written
        // directly here precisely because that is what is being repaired.
        lastInteractionAt: new Date("2026-08-30T12:00:00Z"),
        nextTouchAt: new Date("2026-09-29T12:00:00Z"),
      },
    });

    const older = await interactionAt(owner.id, new Date("2026-06-01T12:00:00Z"), contact.id);
    const newer = await interactionAt(owner.id, new Date("2026-07-01T12:00:00Z"), contact.id);
    // Numbered 2 and 3, as they would be once the first date was removed.
    await prisma.dateEntry.createMany({
      data: [
        { ownerId: owner.id, contactId: contact.id, interactionId: older.id, sequence: 2 },
        { ownerId: owner.id, contactId: contact.id, interactionId: newer.id, sequence: 3 },
      ],
    });

    await prisma.appSetting.create({ data: { key: KEY, value: [contact.id] } });
    await finishSchemaRepairs();

    const repaired = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(repaired.lastInteractionAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(repaired.nextTouchAt?.toISOString()).toBe("2026-07-31T12:00:00.000Z");

    const entries = await prisma.dateEntry.findMany({
      where: { contactId: contact.id },
      orderBy: { sequence: "asc" },
      select: { interactionId: true, sequence: true },
    });
    expect(entries).toEqual([
      { interactionId: older.id, sequence: 1 },
      { interactionId: newer.id, sequence: 2 },
    ]);

    // Cleared once the work has committed, so it is done once rather than at
    // every boot — and not cleared at all if the work failed.
    expect(await prisma.appSetting.findUnique({ where: { key: KEY } })).toBeNull();
  });

  it("does nothing, and says nothing, when the migration left no work", async () => {
    const before = await prisma.appSetting.count();
    await finishSchemaRepairs();
    expect(await prisma.appSetting.count()).toBe(before);
  });
});
