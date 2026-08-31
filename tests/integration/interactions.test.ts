import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, daysAgo, hasTestDatabase, prisma, reset } from "./db";

/**
 * Editing something already logged.
 *
 * `updateInteraction` shipped without a caller, so nothing had ever exercised
 * it — and a write nobody runs is a write nobody has checked. These tests run
 * the action itself rather than an imitation of it, because the parts worth
 * guarding are exactly the parts an imitation would leave out: that it
 * re-validates a POST body it has no reason to trust, that moving an
 * interaction in time goes back through the activity machinery, and that the
 * privacy lock is closed here as firmly as it is on the way in.
 */

/** Mutable so each test can move the account and the lock without re-mocking. */
const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

const TZ = "America/New_York";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: TZ }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: state.enabled,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
}));

const { createInteraction, loadInteractionForEdit, updateInteraction } = await import(
  "@/server/actions/interactions"
);

describe.skipIf(!hasTestDatabase)("updateInteraction", () => {
  // Captured once: `daysAgo` reads the clock, so calling it twice for what is
  // meant to be the same instant produces two that differ by milliseconds.
  const WHEN = daysAgo(10);
  const MOVED = daysAgo(120);

  let sarahId: string;
  let marcusId: string;
  let coffeeId: string;
  let mealId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = false;
    state.unlocked = true;

    const [sarah, marcus] = await Promise.all([
      prisma.contact.create({
        data: { ownerId: user.id, firstName: "Sarah", cadenceDays: 30, createdAt: daysAgo(400) },
      }),
      prisma.contact.create({
        data: { ownerId: user.id, firstName: "Marcus", cadenceDays: 30, createdAt: daysAgo(400) },
      }),
    ]);
    sarahId = sarah.id;
    marcusId = marcus.id;

    // Provisioned for every new account by `createTestUser`, so read them
    // rather than creating a second "coffee" the unique index would reject.
    const [coffee, meal] = await Promise.all([
      prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId: user.id, kind: "INTERACTION_TYPE", slug: "coffee" },
      }),
      prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId: user.id, kind: "INTERACTION_TYPE", slug: "meal" },
      }),
    ]);
    coffeeId = coffee.id;
    mealId = meal.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function formOf(fields: Record<string, string | string[] | undefined>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) form.append(key, one);
    }
    return form;
  }

  async function logged(overrides: Record<string, string | string[]> = {}) {
    const result = await createInteraction(
      formOf({
        contactIds: [sarahId],
        typeId: coffeeId,
        occurredAt: WHEN.toISOString(),
        title: "First time at 's place",
        ...overrides,
      }),
    );
    expect(result.ok).toBe(true);
    return result.data!.id;
  }

  const read = (id: string) =>
    prisma.interaction.findUniqueOrThrow({
      where: { id },
      include: { participants: { select: { contactId: true } } },
    });

  it("rewrites a title the parser mangled", async () => {
    const id = await logged();

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId],
        typeId: coffeeId,
        occurredAt: WHEN.toISOString(),
        title: "First time at Sarah's place",
      }),
    );

    expect(result.ok).toBe(true);
    expect((await read(id)).title).toBe("First time at Sarah's place");
  });

  it("normalizes duplicate people when creating and updating", async () => {
    const id = await logged({ contactIds: [sarahId, sarahId, marcusId, marcusId] });
    expect((await read(id)).participants.map((participant) => participant.contactId).sort()).toEqual(
      [marcusId, sarahId].sort(),
    );

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId, sarahId],
        occurredAt: MOVED.toISOString(),
        title: "Just Sarah",
      }),
    );

    expect(result.ok).toBe(true);
    expect((await read(id)).participants.map((participant) => participant.contactId)).toEqual([
      sarahId,
    ]);
  });

  it("refuses a cross-owner person even when a valid person is submitted twice", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Nobody" },
    });

    const result = await createInteraction(
      formOf({
        contactIds: [sarahId, sarahId, theirs.id],
        occurredAt: WHEN.toISOString(),
        title: "Must not exist",
      }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.interaction.count({ where: { ownerId: state.ownerId } })).toBe(0);
  });

  it("recomputes activity for every participant on create and update", async () => {
    const id = await logged({ contactIds: [sarahId, marcusId] });
    const initiallyUpdated = await Promise.all(
      [sarahId, marcusId].map((id) => prisma.contact.findUniqueOrThrow({ where: { id } })),
    );
    expect(initiallyUpdated.map((contact) => contact.lastInteractionAt?.getTime())).toEqual([
      WHEN.getTime(),
      WHEN.getTime(),
    ]);

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId, marcusId],
        occurredAt: MOVED.toISOString(),
        title: "Moved together",
      }),
    );
    expect(result.ok).toBe(true);
    const moved = await Promise.all(
      [sarahId, marcusId].map((id) => prisma.contact.findUniqueOrThrow({ where: { id } })),
    );
    expect(moved.map((contact) => contact.lastInteractionAt?.getTime())).toEqual([
      MOVED.getTime(),
      MOVED.getTime(),
    ]);
  });

  it("keeps mentioned people separate from attendees and their cadence", async () => {
    const result = await createInteraction(
      formOf({
        contactIds: [sarahId, sarahId],
        mentionedContactIds: [marcusId],
        typeId: coffeeId,
        occurredAt: WHEN.toISOString(),
        title: "Talked about Marcus",
      }),
    );

    expect(result.ok).toBe(true);
    const interaction = await prisma.interaction.findUniqueOrThrow({
      where: { id: result.data!.id },
      include: { participants: true, mentions: true },
    });
    expect(interaction.participants.map((row) => row.contactId)).toEqual([sarahId]);
    expect(interaction.mentions.map((row) => row.contactId)).toEqual([marcusId]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: marcusId } })).lastInteractionAt)
      .toBeNull();
  });

  it("refuses an interaction type belonging to somebody else", async () => {
    const id = await logged();
    const stranger = await createTestUser();
    const theirs = await prisma.taxonomyTerm.create({
      data: { ownerId: stranger.id, kind: "INTERACTION_TYPE", slug: "gym", label: "Gym" },
    });

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId],
        typeId: theirs.id,
        occurredAt: WHEN.toISOString(),
        title: "Coffee",
      }),
    );

    expect(result.ok).toBe(false);
    expect((await read(id)).typeId).toBe(coffeeId);
  });

  it("refuses a person belonging to somebody else", async () => {
    const id = await logged();
    const stranger = await createTestUser();
    const theirs = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Nobody" },
    });

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [theirs.id],
        occurredAt: WHEN.toISOString(),
        title: "Coffee",
      }),
    );

    expect(result.ok).toBe(false);
    expect((await read(id)).participants.map((p) => p.contactId)).toEqual([sarahId]);
  });

  it("refuses to leave an interaction with nobody on it", async () => {
    const id = await logged();

    const result = await updateInteraction(
      formOf({ id, occurredAt: WHEN.toISOString(), title: "Coffee" }),
    );

    expect(result.ok).toBe(false);
    expect((await read(id)).participants).toHaveLength(1);
  });

  it("recomputes last contact for the person dropped as well as the one added", async () => {
    const id = await logged();
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: sarahId } })).lastInteractionAt,
    ).not.toBeNull();

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [marcusId],
        typeId: mealId,
        occurredAt: WHEN.toISOString(),
        title: "Dinner",
      }),
    );

    expect(result.ok).toBe(true);
    // Sarah was never at this dinner, so she must not keep a last-contact date
    // from it — the same rule that makes deleting an interaction safe.
    const [sarah, marcus] = await Promise.all([
      prisma.contact.findUniqueOrThrow({ where: { id: sarahId } }),
      prisma.contact.findUniqueOrThrow({ where: { id: marcusId } }),
    ]);
    expect(sarah.lastInteractionAt).toBeNull();
    expect(marcus.lastInteractionAt?.getTime()).toBe(WHEN.getTime());
  });

  it("moves last contact when the interaction is moved in time", async () => {
    const id = await logged();

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId],
        typeId: coffeeId,
        occurredAt: MOVED.toISOString(),
        title: "Coffee",
      }),
    );

    expect(result.ok).toBe(true);
    const sarah = await prisma.contact.findUniqueOrThrow({ where: { id: sarahId } });
    expect(sarah.lastInteractionAt?.getTime()).toBe(MOVED.getTime());
  });

  it("rejects a title too long for the column instead of failing at the database", async () => {
    const id = await logged();

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [sarahId],
        occurredAt: WHEN.toISOString(),
        title: "x".repeat(200),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.title).toBeTruthy();
  });

  it("will not edit an interaction the closed lock is hiding", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Robin", isPrivate: true },
    });
    const id = await logged({ contactIds: [secret.id] });

    state.enabled = true;
    state.unlocked = false;

    const result = await updateInteraction(
      formOf({
        id,
        contactIds: [secret.id],
        occurredAt: WHEN.toISOString(),
        title: "Guessed at it",
      }),
    );

    expect(result.ok).toBe(false);
    expect((await read(id)).title).toBe("First time at 's place");
  });
});

describe.skipIf(!hasTestDatabase)("loadInteractionForEdit", () => {
  let ownerId: string;
  let sarahId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    state.ownerId = user.id;
    state.enabled = false;
    state.unlocked = true;

    const sarah = await prisma.contact.create({ data: { ownerId, firstName: "Sarah" } });
    sarahId = sarah.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function make(data: Record<string, unknown> = {}) {
    return prisma.interaction.create({
      data: {
        ownerId,
        occurredAt: daysAgo(3),
        title: "Coffee",
        participants: { create: [{ contactId: sarahId }] },
        ...data,
      },
      select: { id: true },
    });
  }

  it("returns the record with its people selected", async () => {
    const { id } = await make();

    const result = await loadInteractionForEdit(id);

    expect(result.ok).toBe(true);
    expect(result.data?.contactIds).toEqual([sarahId]);
    expect(result.data?.contacts.map((c) => c.id)).toContain(sarahId);
  });

  it("includes an archived participant so saving cannot drop them", async () => {
    const archived = await prisma.contact.create({
      data: { ownerId, firstName: "Gone", isArchived: true },
    });
    const { id } = await make({
      participants: { create: [{ contactId: sarahId }, { contactId: archived.id }] },
    });

    const result = await loadInteractionForEdit(id);

    // The picker's own list leaves archived people out. If they were missing
    // here too, opening the sheet and saving would quietly remove them.
    expect(result.data?.contactIds).toContain(archived.id);
    expect(result.data?.contacts.map((c) => c.id)).toContain(archived.id);
  });

  it("withholds an interaction hidden by the closed lock", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId, firstName: "Robin", isPrivate: true },
    });
    const { id } = await make({ participants: { create: [{ contactId: secret.id }] } });

    state.enabled = true;
    state.unlocked = false;

    const result = await loadInteractionForEdit(id);

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("refuses an interaction belonging to somebody else", async () => {
    const stranger = await createTestUser();
    const theirContact = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Theirs" },
    });
    const theirs = await prisma.interaction.create({
      data: {
        ownerId: stranger.id,
        occurredAt: daysAgo(1),
        title: "Not yours",
        participants: { create: [{ contactId: theirContact.id }] },
      },
      select: { id: true },
    });

    const result = await loadInteractionForEdit(theirs.id);

    expect(result.ok).toBe(false);
  });
});
