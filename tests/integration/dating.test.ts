import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, daysAgo, hasTestDatabase, prisma, reset } from "./db";
import {
  recomputeContactActivity,
  resequenceDateEntries,
} from "@/server/services/contact-activity";
import { RENDERED_FIELDS_INPUT, fieldInputName } from "@/lib/custom-fields";

const actionState = vi.hoisted(() => ({ ownerId: "", locked: false }));
vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: actionState.ownerId }, prefs: {}, timezone: "America/New_York" }),
}));
vi.mock("@/server/privacy/lock", () => ({
  requireUnlocked: async () => actionState.locked ? { ok: false, error: "Unlock to continue." } : { ok: true },
}));

const { createDateEntry, updateDateEntry } = await import("@/server/actions/dating");

function actionForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

/**
 * The dating layer's own invariants.
 *
 * These exercise the same rules the server actions rely on, driven directly
 * against the database so they can run without a request context.
 */
describe.skipIf(!hasTestDatabase)("dating", () => {
  let ownerId: string;
  let dateTypeId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    actionState.ownerId = user.id;
    actionState.locked = false;
    const term = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "INTERACTION_TYPE", slug: "date" },
    });
    dateTypeId = term.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeRomantic(cadenceDays: number | null = 7) {
    return prisma.contact.create({
      data: {
        ownerId,
        firstName: "Robin",
        isRomantic: true,
        cadenceDays,
        createdAt: daysAgo(400),
        romanticProfile: { create: { ownerId } },
      },
    });
  }

  /** Mirrors what createDateEntry does, minus the request-scoped plumbing. */
  async function logDate(contactId: string, occurredAt: Date, rating?: number) {
    return prisma.$transaction(async (tx) => {
      const interaction = await tx.interaction.create({
        data: {
          ownerId,
          typeId: dateTypeId,
          occurredAt,
          title: "Date",
          participants: { create: [{ contactId }] },
        },
      });
      const entry = await tx.dateEntry.create({
        data: { ownerId, contactId, interactionId: interaction.id, rating: rating ?? null },
      });
      await recomputeContactActivity(tx, [contactId]);
      await resequenceDateEntries(tx, contactId);
      return entry;
    });
  }

  const sequences = async (contactId: string) =>
    Object.fromEntries(
      (
        await prisma.dateEntry.findMany({
          where: { contactId },
          select: { id: true, sequence: true },
        })
      ).map((d) => [d.id, d.sequence]),
    );

  it("a date creates both an interaction and a date entry", async () => {
    const contact = await makeRomantic();
    const entry = await logDate(contact.id, daysAgo(3));

    const stored = await prisma.dateEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { interaction: { include: { participants: true } } },
    });
    expect(stored.interaction.participants).toHaveLength(1);
    expect(stored.interaction.participants[0].contactId).toBe(contact.id);

    // It is a normal interaction, so it shows up in the unified timeline too.
    const timelineCount = await prisma.interaction.count({
      where: { ownerId, participants: { some: { contactId: contact.id } } },
    });
    expect(timelineCount).toBe(1);
  });

  it("create and update persist nullable post-date reflections", async () => {
    const contact = await makeRomantic();
    const created = await createDateEntry(actionForm({
      contactId: contact.id,
      occurredAt: new Date().toISOString(),
      wouldDoAgain: "true",
      nextTimeNotes: "Reserve the patio.",
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    let stored = await prisma.dateEntry.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(stored.wouldDoAgain).toBe(true);
    expect(stored.nextTimeNotes).toBe("Reserve the patio.");

    const updated = await updateDateEntry(actionForm({
      id: stored.id,
      wouldDoAgain: "false",
      nextTimeNotes: "Try somewhere quieter.",
    }));
    expect(updated.ok).toBe(true);
    stored = await prisma.dateEntry.findUniqueOrThrow({ where: { id: stored.id } });
    expect(stored.wouldDoAgain).toBe(false);
    expect(stored.nextTimeNotes).toBe("Try somewhere quieter.");
  });

  it("saves a custom field on a date edit, not only on create", async () => {
    // The edit form renders these, so an update that never persisted them
    // reported success and discarded every correction typed into one.
    const definition = await prisma.customFieldDefinition.create({
      data: {
        ownerId,
        entity: "DATE_ENTRY",
        key: "venue-vibe",
        label: "Vibe",
        fieldType: "TEXT",
        sortOrder: 0,
      },
    });

    const created = await createDateEntry(actionForm({
      contactId: (await makeRomantic()).id,
      occurredAt: new Date().toISOString(),
      [RENDERED_FIELDS_INPUT]: definition.id,
      [fieldInputName(definition.id)]: "Loud",
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const id = created.data!.id;

    expect(
      await prisma.customFieldValue.findFirst({
        where: { ownerId, entityType: "DATE_ENTRY", entityId: id },
      }),
    ).toMatchObject({ value: "Loud" });

    const updated = await updateDateEntry(actionForm({
      id,
      [RENDERED_FIELDS_INPUT]: definition.id,
      [fieldInputName(definition.id)]: "Quieter than expected",
    }));
    expect(updated.ok).toBe(true);

    expect(
      await prisma.customFieldValue.findFirst({
        where: { ownerId, entityType: "DATE_ENTRY", entityId: id },
      }),
    ).toMatchObject({ value: "Quieter than expected" });
  });

  it("rejects creating a retrospective against another owner's contact", async () => {
    const stranger = await createTestUser();
    const contact = await prisma.contact.create({ data: { ownerId: stranger.id, firstName: "Not mine" } });
    const result = await createDateEntry(actionForm({ contactId: contact.id, wouldDoAgain: "true" }));
    expect(result).toMatchObject({ ok: false, error: "Contact not found." });
    expect(await prisma.dateEntry.count()).toBe(0);
  });

  it("rejects retrospective writes while the privacy lock is closed", async () => {
    const contact = await makeRomantic();
    actionState.locked = true;
    const result = await createDateEntry(actionForm({ contactId: contact.id, wouldDoAgain: "true" }));
    expect(result).toMatchObject({ ok: false, error: "Unlock to continue." });
    expect(await prisma.dateEntry.count()).toBe(0);
  });

  it("a date backdated between two others renumbers the sequence", async () => {
    const contact = await makeRomantic();
    const first = await logDate(contact.id, daysAgo(30));
    const third = await logDate(contact.id, daysAgo(5));
    // Remembered late, but it actually happened in between.
    const second = await logDate(contact.id, daysAgo(20));

    const seq = await sequences(contact.id);
    expect(seq[first.id]).toBe(1);
    expect(seq[second.id]).toBe(2);
    expect(seq[third.id]).toBe(3);
  });

  it("backdating a date does not move the last-contact clock", async () => {
    const contact = await makeRomantic(7);
    const recent = daysAgo(2);
    await logDate(contact.id, recent);
    await logDate(contact.id, daysAgo(60));

    const after = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
      select: { lastInteractionAt: true },
    });
    expect(after.lastInteractionAt?.getTime()).toBe(recent.getTime());
  });

  it("deleting a date removes its interaction and resequences the rest", async () => {
    const contact = await makeRomantic();
    const first = await logDate(contact.id, daysAgo(30));
    const middle = await logDate(contact.id, daysAgo(20));
    const last = await logDate(contact.id, daysAgo(10));

    const middleRow = await prisma.dateEntry.findUniqueOrThrow({ where: { id: middle.id } });
    await prisma.$transaction(async (tx) => {
      await tx.interaction.delete({ where: { id: middleRow.interactionId } });
      await recomputeContactActivity(tx, [contact.id]);
      await resequenceDateEntries(tx, contact.id);
    });

    // The DateEntry cascades away with its interaction — never half-removed.
    expect(await prisma.dateEntry.findUnique({ where: { id: middle.id } })).toBeNull();
    expect(await prisma.interaction.findUnique({ where: { id: middleRow.interactionId } })).toBeNull();

    const seq = await sequences(contact.id);
    expect(seq[first.id]).toBe(1);
    expect(seq[last.id]).toBe(2);
  });

  it("deleting the most recent date rolls last-contact back", async () => {
    const contact = await makeRomantic(7);
    const older = daysAgo(40);
    await logDate(contact.id, older);
    const newest = await logDate(contact.id, daysAgo(4));

    const newestRow = await prisma.dateEntry.findUniqueOrThrow({ where: { id: newest.id } });
    await prisma.$transaction(async (tx) => {
      await tx.interaction.delete({ where: { id: newestRow.interactionId } });
      await recomputeContactActivity(tx, [contact.id]);
      await resequenceDateEntries(tx, contact.id);
    });

    const after = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
      select: { lastInteractionAt: true },
    });
    expect(after.lastInteractionAt?.getTime()).toBe(older.getTime());
  });

  it("converting to a friend keeps every date, flag and note", async () => {
    const contact = await makeRomantic();
    await logDate(contact.id, daysAgo(12), 5);
    await prisma.flag.create({
      data: { ownerId, contactId: contact.id, kind: "GREEN", text: "Kind to waiters" },
    });
    await prisma.romanticProfile.update({
      where: { contactId: contact.id },
      data: { privateNotes: "Something I would not want read aloud." },
    });

    await prisma.contact.update({ where: { id: contact.id }, data: { isRomantic: false } });

    const after = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
      include: { romanticProfile: true, flags: true, dateEntries: true },
    });
    expect(after.isRomantic).toBe(false);
    // Nothing is destroyed by a status change.
    expect(after.romanticProfile).not.toBeNull();
    expect(after.romanticProfile?.privateNotes).toBe("Something I would not want read aloud.");
    expect(after.flags).toHaveLength(1);
    expect(after.dateEntries).toHaveLength(1);
  });

  it("the pipeline keys on isRomantic, so an ex does not reappear", async () => {
    const current = await makeRomantic();
    const ex = await makeRomantic();
    await prisma.contact.update({ where: { id: ex.id }, data: { isRomantic: false } });

    const inPipeline = await prisma.contact.findMany({
      where: { ownerId, isRomantic: true, isArchived: false },
      select: { id: true },
    });
    expect(inPipeline.map((c) => c.id)).toEqual([current.id]);

    // ...but their profile is still there if they are flagged again.
    expect(await prisma.romanticProfile.findUnique({ where: { contactId: ex.id } })).not.toBeNull();
  });

  it("ending records the reason and the retrospective separately", async () => {
    const contact = await makeRomantic();
    await prisma.romanticProfile.update({
      where: { contactId: contact.id },
      data: {
        endedOn: new Date(Date.UTC(2026, 5, 1)),
        endedReason: "She moved to Chicago.",
        retrospective: "I waited too long to say what I wanted.",
        exclusive: false,
      },
    });

    const profile = await prisma.romanticProfile.findUniqueOrThrow({
      where: { contactId: contact.id },
    });
    expect(profile.endedReason).toBe("She moved to Chicago.");
    expect(profile.retrospective).toBe("I waited too long to say what I wanted.");
    expect(profile.endedOn).not.toBeNull();
  });
});
