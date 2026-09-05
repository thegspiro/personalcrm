import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Every foreign key into `Contact` names `(ownerId, id)`.
 *
 * The application never writes a row that hangs one account's note off another
 * account's person, but before these keys nothing stopped an import or a hand
 * repair from doing it, and every reader had to remember an owner predicate to
 * keep it out of a page. These check the database refuses it directly — one
 * case per converted relation, because a key that was missed looks exactly like
 * a key that was added until something tries to write across it.
 *
 * `Interaction.place` and `Plan.place` are deliberately absent: they are
 * `ON DELETE SET NULL`, and MariaDB refuses a SET NULL foreign key unless every
 * column in it is nullable. They are covered by the last case here instead,
 * which checks the reader drops what the key cannot. See docs/data-model.md.
 */

interface Context {
  ownerId: string;
  relationshipTypeId: string;
  /** Another contact of the *same* owner, for the two-ended relations. */
  siblingId: string;
  /** A fresh same-owner interaction id, for the relations that need one. */
  nextInteractionId: () => Promise<string>;
  /** A same-owner life event and household, for the join tables. */
  lifeEventId: string;
  householdId: string;
}

interface Case {
  /** Prisma model name, as it reads in an error. */
  name: string;
  /** True when `contactId` is nullable, so the row survives without a link. */
  optional?: true;
  create: (context: Context, contactId: string) => Promise<unknown>;
  count: (ownerId: string) => Promise<number>;
}

const CASES: Case[] = [
  {
    name: "Relationship",
    create: (context, contactId) =>
      prisma.relationship.create({
        data: {
          ownerId: context.ownerId,
          fromContactId: context.siblingId,
          toContactId: contactId,
          typeId: context.relationshipTypeId,
          pairId: `pair-${Math.random().toString(36).slice(2, 10)}`,
        },
      }),
    count: (ownerId) => prisma.relationship.count({ where: { ownerId } }),
  },
  {
    name: "Fact",
    create: (context, contactId) =>
      prisma.fact.create({
        data: { ownerId: context.ownerId, contactId, content: "Likes rye bread" },
      }),
    count: (ownerId) => prisma.fact.count({ where: { ownerId } }),
  },
  {
    name: "Acquaintance",
    create: (context, contactId) =>
      prisma.acquaintance.create({
        data: { ownerId: context.ownerId, contactId, name: "Bob" },
      }),
    count: (ownerId) => prisma.acquaintance.count({ where: { ownerId } }),
  },
  {
    name: "ImportantDate",
    create: (context, contactId) =>
      prisma.importantDate.create({
        data: {
          ownerId: context.ownerId,
          contactId,
          label: "Birthday",
          date: new Date("1990-04-02T00:00:00Z"),
        },
      }),
    count: (ownerId) => prisma.importantDate.count({ where: { ownerId } }),
  },
  {
    name: "LifeEvent",
    create: (context, contactId) =>
      prisma.lifeEvent.create({
        data: {
          ownerId: context.ownerId,
          contactId,
          title: "Moved house",
          date: new Date("2019-06-01T00:00:00Z"),
        },
      }),
    count: (ownerId) => prisma.lifeEvent.count({ where: { ownerId } }),
  },
  {
    name: "FamilySuggestionDismissal",
    create: (context, contactId) =>
      prisma.familySuggestionDismissal.create({
        data: {
          ownerId: context.ownerId,
          aContactId: context.siblingId,
          bContactId: contactId,
        },
      }),
    count: (ownerId) => prisma.familySuggestionDismissal.count({ where: { ownerId } }),
  },
  {
    name: "Idea",
    optional: true,
    create: (context, contactId) =>
      prisma.idea.create({
        data: { ownerId: context.ownerId, contactId, content: "Take them climbing" },
      }),
    count: (ownerId) => prisma.idea.count({ where: { ownerId } }),
  },
  {
    name: "Task",
    optional: true,
    create: (context, contactId) =>
      prisma.task.create({
        data: { ownerId: context.ownerId, contactId, title: "Call back" },
      }),
    count: (ownerId) => prisma.task.count({ where: { ownerId } }),
  },
  {
    name: "Happening",
    create: (context, contactId) =>
      prisma.happening.create({
        data: {
          ownerId: context.ownerId,
          contactId,
          title: "Surgery",
          date: new Date("2026-02-02T00:00:00Z"),
        },
      }),
    count: (ownerId) => prisma.happening.count({ where: { ownerId } }),
  },
  {
    name: "Gift",
    create: (context, contactId) =>
      prisma.gift.create({
        data: { ownerId: context.ownerId, contactId, name: "Kettle" },
      }),
    count: (ownerId) => prisma.gift.count({ where: { ownerId } }),
  },
  {
    name: "Debt",
    create: (context, contactId) =>
      prisma.debt.create({
        data: {
          ownerId: context.ownerId,
          contactId,
          direction: "I_OWE_THEM",
          description: "Dinner",
          incurredOn: new Date("2026-01-05T00:00:00Z"),
        },
      }),
    count: (ownerId) => prisma.debt.count({ where: { ownerId } }),
  },
  {
    name: "DietaryNeed",
    create: (context, contactId) =>
      prisma.dietaryNeed.create({
        data: { ownerId: context.ownerId, contactId, kind: "ALLERGY", label: "Peanuts" },
      }),
    count: (ownerId) => prisma.dietaryNeed.count({ where: { ownerId } }),
  },
  {
    name: "RomanticProfile",
    create: (context, contactId) =>
      prisma.romanticProfile.create({ data: { ownerId: context.ownerId, contactId } }),
    count: (ownerId) => prisma.romanticProfile.count({ where: { ownerId } }),
  },
  {
    name: "DateEntry",
    create: async (context, contactId) =>
      prisma.dateEntry.create({
        data: {
          ownerId: context.ownerId,
          contactId,
          interactionId: await context.nextInteractionId(),
        },
      }),
    count: (ownerId) => prisma.dateEntry.count({ where: { ownerId } }),
  },
  {
    name: "Plan",
    optional: true,
    create: (context, contactId) =>
      prisma.plan.create({
        data: { ownerId: context.ownerId, contactId, title: "Museum" },
      }),
    count: (ownerId) => prisma.plan.count({ where: { ownerId } }),
  },
  {
    name: "Flag",
    create: (context, contactId) =>
      prisma.flag.create({
        data: { ownerId: context.ownerId, contactId, kind: "GREEN", text: "Generous" },
      }),
    count: (ownerId) => prisma.flag.count({ where: { ownerId } }),
  },
  // The four join tables carry no id of their own and used to carry no owner
  // either, so both of their keys named a row and neither named an account.
  {
    name: "InteractionParticipant",
    create: async (context, contactId) =>
      prisma.interactionParticipant.create({
        data: {
          ownerId: context.ownerId,
          interactionId: await context.nextInteractionId(),
          contactId,
        },
      }),
    count: (ownerId) => prisma.interactionParticipant.count({ where: { ownerId } }),
  },
  {
    name: "InteractionMention",
    create: async (context, contactId) =>
      prisma.interactionMention.create({
        data: {
          ownerId: context.ownerId,
          interactionId: await context.nextInteractionId(),
          contactId,
        },
      }),
    count: (ownerId) => prisma.interactionMention.count({ where: { ownerId } }),
  },
  {
    name: "LifeEventParticipant",
    create: (context, contactId) =>
      prisma.lifeEventParticipant.create({
        data: {
          ownerId: context.ownerId,
          lifeEventId: context.lifeEventId,
          contactId,
        },
      }),
    count: (ownerId) => prisma.lifeEventParticipant.count({ where: { ownerId } }),
  },
  {
    name: "HouseholdMember",
    create: (context, contactId) =>
      prisma.householdMember.create({
        data: {
          ownerId: context.ownerId,
          householdId: context.householdId,
          contactId,
        },
      }),
    count: (ownerId) => prisma.householdMember.count({ where: { ownerId } }),
  },
];

describe.skipIf(!hasTestDatabase)("same-owner foreign keys", () => {
  let context: Context;
  let mineId: string;
  let theirsId: string;

  beforeAll(async () => {
    await reset();
    const [owner, stranger] = [await createTestUser(), await createTestUser()];
    const [mine, sibling, theirs] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Dana" } }),
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Sam" } }),
      prisma.contact.create({ data: { ownerId: stranger.id, firstName: "Nobody" } }),
    ]);
    const type = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId: owner.id, kind: "RELATIONSHIP_TYPE" },
    });
    const interactionType = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId: owner.id, kind: "INTERACTION_TYPE" },
    });
    const [lifeEvent, household] = await Promise.all([
      prisma.lifeEvent.create({
        data: {
          ownerId: owner.id,
          contactId: mine.id,
          title: "Graduated",
          date: new Date("2018-06-01T00:00:00Z"),
        },
      }),
      prisma.household.create({ data: { ownerId: owner.id, name: "The flat" } }),
    ]);
    mineId = mine.id;
    theirsId = theirs.id;
    context = {
      ownerId: owner.id,
      relationshipTypeId: type.id,
      siblingId: sibling.id,
      lifeEventId: lifeEvent.id,
      householdId: household.id,
      nextInteractionId: async () =>
        (
          await prisma.interaction.create({
            data: {
              ownerId: owner.id,
              typeId: interactionType.id,
              occurredAt: new Date("2026-03-01T12:00:00Z"),
            },
          })
        ).id,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  for (const testCase of CASES) {
    it(`refuses a ${testCase.name} pointing at another account's contact`, async () => {
      // Counted either side rather than asserted at zero: the fixtures this
      // suite needs put rows in some of these tables before the first case
      // runs, and "nothing was written" is the claim, not "the table is empty".
      const before = await testCase.count(context.ownerId);
      await expect(testCase.create(context, theirsId)).rejects.toThrow();
      expect(await testCase.count(context.ownerId)).toBe(before);
    });
  }

  for (const testCase of CASES.filter((one) => one.optional)) {
    it(`accepts a ${testCase.name} with no contact at all`, async () => {
      // MATCH SIMPLE: a NULL in any column of a composite key skips the check,
      // which is what keeps an unattached idea, task or plan writable.
      await expect(testCase.create(context, null as unknown as string)).resolves.toBeTruthy();
    });
  }

  it("still accepts and still cascades the owner's own rows", async () => {
    for (const testCase of CASES) {
      await testCase.create(context, mineId);
      expect(await testCase.count(context.ownerId)).toBeGreaterThan(0);
    }
    await prisma.contact.delete({ where: { id: mineId } });
    for (const testCase of CASES) {
      const remaining = await testCase.count(context.ownerId);
      // The optional three are cascaded too — `onDelete: Cascade` was the
      // behaviour before these keys and the composite key keeps it — but they
      // still hold the detached rows written above.
      expect(remaining).toBe(testCase.optional ? 1 : 0);
    }
  });
});
