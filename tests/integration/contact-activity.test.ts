import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestUser,
  daysAgo,
  daysFromNow,
  hasTestDatabase,
  prisma,
  reset,
} from "./db";
import {
  participantsOf,
  recomputeContactActivity,
  resequenceDateEntries,
} from "@/server/services/contact-activity";

/**
 * The rules that make historical entry safe.
 *
 * Logging something you did three months ago must not look like you spoke
 * today — that would quietly clear the person off the overdue list, which is
 * the one thing this app exists to get right.
 */
describe.skipIf(!hasTestDatabase)("recomputeContactActivity", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeContact(overrides: Partial<{ cadenceDays: number | null; createdAt: Date }> = {}) {
    return prisma.contact.create({
      data: {
        ownerId,
        firstName: "Sam",
        cadenceDays: overrides.cadenceDays === undefined ? 30 : overrides.cadenceDays,
        createdAt: overrides.createdAt ?? daysAgo(400),
      },
    });
  }

  async function logInteraction(contactIds: string[], occurredAt: Date) {
    const interaction = await prisma.interaction.create({
      data: {
        ownerId,
        occurredAt,
        title: `logged for ${occurredAt.toISOString()}`,
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
      },
    });
    await prisma.$transaction((tx) => recomputeContactActivity(tx, contactIds));
    return interaction;
  }

  const read = (id: string) =>
    prisma.contact.findUniqueOrThrow({
      where: { id },
      select: { lastInteractionAt: true, nextTouchAt: true },
    });

  it("sets last contact from the only interaction", async () => {
    const contact = await makeContact();
    const when = daysAgo(10);
    await logInteraction([contact.id], when);

    const after = await read(contact.id);
    expect(after.lastInteractionAt?.getTime()).toBe(when.getTime());
  });

  it("does NOT move last contact backwards when you backfill an older interaction", async () => {
    const contact = await makeContact();
    const recent = daysAgo(5);
    await logInteraction([contact.id], recent);

    // The regression this whole service exists to prevent.
    await logInteraction([contact.id], daysAgo(90));

    const after = await read(contact.id);
    expect(after.lastInteractionAt?.getTime()).toBe(recent.getTime());
  });

  it("keeps an overdue contact overdue after backfilling old history", async () => {
    const contact = await makeContact({ cadenceDays: 30 });
    await logInteraction([contact.id], daysAgo(60));
    const before = await read(contact.id);
    expect(before.nextTouchAt!.getTime()).toBeLessThan(Date.now());

    await logInteraction([contact.id], daysAgo(200));

    const after = await read(contact.id);
    expect(after.nextTouchAt!.getTime()).toBeLessThan(Date.now());
    expect(after.nextTouchAt!.getTime()).toBe(before.nextTouchAt!.getTime());
  });

  it("advances last contact when the new interaction really is the newest", async () => {
    const contact = await makeContact();
    await logInteraction([contact.id], daysAgo(90));
    const newest = daysAgo(2);
    await logInteraction([contact.id], newest);

    const after = await read(contact.id);
    expect(after.lastInteractionAt?.getTime()).toBe(newest.getTime());
  });

  it("falls back to the previous interaction when the newest is deleted", async () => {
    const contact = await makeContact();
    const older = daysAgo(40);
    await logInteraction([contact.id], older);
    const newest = await logInteraction([contact.id], daysAgo(3));

    await prisma.interaction.delete({ where: { id: newest.id } });
    await prisma.$transaction((tx) => recomputeContactActivity(tx, [contact.id]));

    const after = await read(contact.id);
    expect(after.lastInteractionAt?.getTime()).toBe(older.getTime());
  });

  it("clears last contact when every interaction is gone", async () => {
    const contact = await makeContact();
    const only = await logInteraction([contact.id], daysAgo(10));

    await prisma.interaction.delete({ where: { id: only.id } });
    await prisma.$transaction((tx) => recomputeContactActivity(tx, [contact.id]));

    const after = await read(contact.id);
    expect(after.lastInteractionAt).toBeNull();
  });

  it("ignores future-dated interactions — a planned dinner is not a past one", async () => {
    const contact = await makeContact();
    const past = daysAgo(20);
    await logInteraction([contact.id], past);
    await logInteraction([contact.id], daysFromNow(7));

    const after = await read(contact.id);
    expect(after.lastInteractionAt?.getTime()).toBe(past.getTime());
  });

  it("leaves last contact null when the only interaction is in the future", async () => {
    const contact = await makeContact();
    await logInteraction([contact.id], daysFromNow(3));

    const after = await read(contact.id);
    expect(after.lastInteractionAt).toBeNull();
  });

  it("updates every participant of a group interaction", async () => {
    const a = await makeContact();
    const b = await makeContact();
    const when = daysAgo(6);
    await logInteraction([a.id, b.id], when);

    expect((await read(a.id)).lastInteractionAt?.getTime()).toBe(when.getTime());
    expect((await read(b.id)).lastInteractionAt?.getTime()).toBe(when.getTime());
  });

  it("does not leak activity between contacts who share nothing", async () => {
    const a = await makeContact();
    const b = await makeContact();
    await logInteraction([a.id], daysAgo(4));

    expect((await read(b.id)).lastInteractionAt).toBeNull();
  });

  it("leaves nextTouchAt null when the contact has no cadence", async () => {
    const contact = await makeContact({ cadenceDays: null });
    await logInteraction([contact.id], daysAgo(5));

    const after = await read(contact.id);
    expect(after.lastInteractionAt).not.toBeNull();
    expect(after.nextTouchAt).toBeNull();
  });

  it("counts the cadence forward from the real last interaction", async () => {
    const contact = await makeContact({ cadenceDays: 30 });
    const last = daysAgo(10);
    await logInteraction([contact.id], last);

    const after = await read(contact.id);
    expect(after.nextTouchAt!.getTime()).toBe(last.getTime() + 30 * 86_400_000);
  });

  it("is a no-op when nothing changed, so re-running is safe", async () => {
    const contact = await makeContact();
    await logInteraction([contact.id], daysAgo(9));
    const first = await read(contact.id);

    await prisma.$transaction((tx) => recomputeContactActivity(tx, [contact.id]));
    const second = await read(contact.id);

    expect(second.lastInteractionAt?.getTime()).toBe(first.lastInteractionAt?.getTime());
    expect(second.nextTouchAt?.getTime()).toBe(first.nextTouchAt?.getTime());
  });

  it("tolerates an empty or unknown id list", async () => {
    await expect(
      prisma.$transaction((tx) => recomputeContactActivity(tx, [])),
    ).resolves.toBeUndefined();
    await expect(
      prisma.$transaction((tx) => recomputeContactActivity(tx, ["does-not-exist"])),
    ).resolves.toBeUndefined();
  });

  it("participantsOf returns each contact once", async () => {
    const a = await makeContact();
    const b = await makeContact();
    const one = await logInteraction([a.id, b.id], daysAgo(3));
    const two = await logInteraction([a.id], daysAgo(2));

    const ids = await prisma.$transaction((tx) => participantsOf(tx, [one.id, two.id]));
    expect([...ids].sort()).toEqual([a.id, b.id].sort());
  });
});

describe.skipIf(!hasTestDatabase)("resequenceDateEntries", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renumbers by when the date happened, not when it was entered", async () => {
    const contact = await prisma.contact.create({
      data: { ownerId, firstName: "Robin", isRomantic: true },
    });

    async function addDate(occurredAt: Date, sequence: number) {
      const interaction = await prisma.interaction.create({
        data: { ownerId, occurredAt, participants: { create: [{ contactId: contact.id }] } },
      });
      return prisma.dateEntry.create({
        data: { ownerId, contactId: contact.id, interactionId: interaction.id, sequence },
      });
    }

    const first = await addDate(daysAgo(30), 1);
    const second = await addDate(daysAgo(10), 2);
    // A date remembered later, but which actually happened between the two.
    const forgotten = await addDate(daysAgo(20), 3);

    await prisma.$transaction((tx) => resequenceDateEntries(tx, contact.id));

    const sequences = Object.fromEntries(
      (
        await prisma.dateEntry.findMany({
          where: { contactId: contact.id },
          select: { id: true, sequence: true },
        })
      ).map((d) => [d.id, d.sequence]),
    );

    expect(sequences[first.id]).toBe(1);
    expect(sequences[forgotten.id]).toBe(2);
    expect(sequences[second.id]).toBe(3);
  });
});
