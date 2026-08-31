import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, daysAgo, hasTestDatabase, prisma, reset } from "./db";
import {
  contactPrivacyWhere,
  factPrivacyWhere,
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  viaContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/where";

/**
 * The privacy lock's enforcement layer.
 *
 * These test the where-fragments directly against the database, because that
 * is where the lock actually lives. Testing that a component renders nothing
 * would prove very little — with server components the rows would already have
 * been fetched and serialised into the payload.
 */
const LOCKED: PrivacyScope = { enabled: true, unlocked: false };
const UNLOCKED: PrivacyScope = { enabled: true, unlocked: true };
const OFF: PrivacyScope = { enabled: false, unlocked: true };

describe.skipIf(!hasTestDatabase)("privacy filters", () => {
  let ownerId: string;
  let publicContactId: string;
  let privateContactId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;

    const open = await prisma.contact.create({
      data: { ownerId, firstName: "Public", isPrivate: false },
    });
    const secret = await prisma.contact.create({
      data: { ownerId, firstName: "Secret", isPrivate: true },
    });
    publicContactId = open.id;
    privateContactId = secret.id;

    await prisma.fact.createMany({
      data: [
        { ownerId, contactId: open.id, content: "Ordinary fact", isPrivate: false },
        { ownerId, contactId: open.id, content: "Sensitive fact", isPrivate: true },
      ],
    });

    // An openly logged interaction, one marked private, and one whose only
    // participant is a private person.
    for (const [contactId, isPrivate] of [
      [open.id, false],
      [open.id, true],
      [secret.id, false],
    ] as Array<[string, boolean]>) {
      await prisma.interaction.create({
        data: {
          ownerId,
          occurredAt: daysAgo(2),
          title: isPrivate ? "Private interaction" : "Interaction",
          isPrivate,
          participants: { create: [{ contactId }] },
        },
      });
    }

    await prisma.task.createMany({
      data: [
        { ownerId, contactId: open.id, title: "Open task" },
        { ownerId, contactId: secret.id, title: "Secret task" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const contacts = (scope: PrivacyScope) =>
    prisma.contact.findMany({ where: { ownerId, ...contactPrivacyWhere(scope) } });
  const facts = (scope: PrivacyScope) =>
    prisma.fact.findMany({ where: { ownerId, ...factPrivacyWhere(scope) } });
  const interactions = (scope: PrivacyScope) =>
    prisma.interaction.findMany({ where: { ownerId, ...interactionPrivacyWhere(scope) } });
  const tasks = (scope: PrivacyScope) =>
    prisma.task.findMany({ where: { ownerId, ...viaContactPrivacyWhere(scope) } });
  const milestones = (scope: PrivacyScope) =>
    prisma.lifeEvent.findMany({
      where: { ownerId, isMilestone: true, ...lifeEventPrivacyWhere(scope) },
    });

  it("withholds private contacts while locked", async () => {
    const locked = await contacts(LOCKED);
    expect(locked.map((c) => c.id)).toEqual([publicContactId]);

    const unlocked = await contacts(UNLOCKED);
    expect(unlocked).toHaveLength(2);
  });

  it("withholds private facts on an otherwise ordinary contact", async () => {
    const locked = await facts(LOCKED);
    expect(locked.map((f) => f.content)).toEqual(["Ordinary fact"]);
    expect(await facts(UNLOCKED)).toHaveLength(2);
  });

  it("withholds an interaction marked private", async () => {
    const locked = await interactions(LOCKED);
    expect(locked.some((i) => i.title === "Private interaction")).toBe(false);
  });

  it("withholds an interaction whose participant is private, even when the interaction is not", async () => {
    const locked = await interactions(LOCKED);
    const ids = new Set(locked.map((i) => i.id));

    const viaSecret = await prisma.interaction.findMany({
      where: { participants: { some: { contactId: privateContactId } } },
      select: { id: true },
    });
    expect(viaSecret).toHaveLength(1);
    // Logging "dinner" against a private person must not leak through the
    // timeline just because the interaction itself was not marked.
    expect(ids.has(viaSecret[0].id)).toBe(false);

    expect(await interactions(UNLOCKED)).toHaveLength(3);
  });

  it("withholds rows reached through a private contact", async () => {
    const locked = await tasks(LOCKED);
    expect(locked.map((t) => t.title)).toEqual(["Open task"]);
    expect(await tasks(UNLOCKED)).toHaveLength(2);
  });

  it("withholds a shared event when either the event or any participant is private", async () => {
    await prisma.lifeEvent.create({ data: { ownerId, title: "Shared secret", date: daysAgo(1), participants: { create: [{ contactId: publicContactId }, { contactId: privateContactId }] } } });
    await prisma.lifeEvent.create({ data: { ownerId, title: "Private row", date: daysAgo(1), isPrivate: true, participants: { create: { contactId: publicContactId } } } });
    const locked = await prisma.lifeEvent.findMany({ where: { ownerId, ...lifeEventPrivacyWhere(LOCKED) } });
    expect(locked).toHaveLength(0);
    expect(await prisma.lifeEvent.count({ where: { ownerId, ...lifeEventPrivacyWhere(UNLOCKED) } })).toBe(2);
  });

  it("withholds a private contact's milestone while the lock is closed", async () => {
    await prisma.lifeEvent.create({ data: { ownerId, title: "Public milestone", date: daysAgo(20), isMilestone: true, participants: { create: { contactId: publicContactId } } } });
    await prisma.lifeEvent.create({ data: { ownerId, title: "Private milestone", date: daysAgo(30), isMilestone: true, participants: { create: { contactId: privateContactId } } } });
    expect((await milestones(LOCKED)).map((item) => item.title)).toEqual(["Public milestone"]);
    expect(await milestones(UNLOCKED)).toHaveLength(2);
  });

  it("hides nothing when the lock is switched off", async () => {
    expect(await contacts(OFF)).toHaveLength(2);
    expect(await facts(OFF)).toHaveLength(2);
    expect(await interactions(OFF)).toHaveLength(3);
    expect(await tasks(OFF)).toHaveLength(2);
  });

  it("counts are filtered too, so a shifting total does not reveal what is hidden", async () => {
    const lockedCount = await prisma.contact.count({
      where: { ownerId, ...contactPrivacyWhere(LOCKED) },
    });
    const unlockedCount = await prisma.contact.count({
      where: { ownerId, ...contactPrivacyWhere(UNLOCKED) },
    });
    expect(lockedCount).toBe(1);
    expect(unlockedCount).toBe(2);
  });
});
