import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Correcting something already written down.
 *
 * Every entry in this app used to be add-and-delete: a typo in a fact, a debt
 * recorded the wrong way round, a red flag you decided was nothing — the only
 * remedy was to delete the row and type it again, which throws away the
 * category, the date and the note along with the mistake.
 *
 * These run the actions themselves rather than an imitation, because the parts
 * worth guarding are the parts an imitation leaves out: that each one
 * re-validates a POST body it has no reason to trust, that it scopes by owner,
 * that the privacy lock is closed on the way out as firmly as on the way in,
 * and that a form missing a field does not quietly clear it.
 */

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
  requireUnlocked: async () =>
    state.enabled && !state.unlocked
      ? { ok: false, error: "Unlock to continue." }
      : { ok: true },
}));

const {
  createLifeEvent,
  updateDebt,
  updateDietaryNeed,
  updateFact,
  updateGift,
  updateImportantDate,
  updateLifeEvent,
  updateIdea,
  updateRelationship,
  updateTask,
} = await import("@/server/actions/details");
const { updateFlag } = await import("@/server/actions/dating");

/** FormData from a plain object, so each test reads as the form it stands for. */
function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe.skipIf(!hasTestDatabase)("editing an entry", () => {
  let ownerId: string;
  let strangerId: string;
  let sarahId: string;
  let marcusId: string;

  beforeEach(async () => {
    await reset();
    const [user, stranger] = await Promise.all([createTestUser(), createTestUser()]);
    ownerId = user.id;
    strangerId = stranger.id;
    state.ownerId = user.id;
    state.enabled = false;
    state.unlocked = true;

    const [sarah, marcus] = await Promise.all([
      prisma.contact.create({ data: { ownerId, firstName: "Sarah" } }),
      prisma.contact.create({ data: { ownerId, firstName: "Marcus" } }),
    ]);
    sarahId = sarah.id;
    marcusId = marcus.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- facts ---------------------------------------------------------------

  describe("a life event range", () => {
    it("returns an end-date error and does not write a definitively inverted range", async () => {
      const result = await createLifeEvent(
        form({
          contactId: sarahId,
          title: "Worked abroad",
          date: "2020-01-01",
          datePrecision: "YEAR",
          endDate: "2019-12-01",
          endDatePrecision: "MONTH",
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { endDate: "End date must not be before the start date." },
      });
      expect(await prisma.lifeEvent.count({ where: { ownerId } })).toBe(0);
    });
  });

  describe("timeline history behind a private contact", () => {
    it("cannot be changed with remembered date or event ids while locked", async () => {
      const privateContact = await prisma.contact.create({
        data: { ownerId, firstName: "Hidden", isPrivate: true },
      });
      const [date, event] = await Promise.all([
        prisma.importantDate.create({
          data: { ownerId, contactId: privateContact.id, label: "Anniversary", date: new Date("2020-01-02T00:00:00Z") },
        }),
        prisma.lifeEvent.create({
          data: { ownerId, contactId: privateContact.id, title: "Moved home", date: new Date("2020-01-02T00:00:00Z") },
        }),
      ]);

      state.enabled = true;
      state.unlocked = false;

      expect(await updateImportantDate(form({ id: date.id, label: "Exposed", date: "2021-02-03" }))).toMatchObject({ ok: false });
      expect(await updateLifeEvent(form({ id: event.id, title: "Exposed", date: "2021-02-03" }))).toMatchObject({ ok: false });
      expect((await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } })).label).toBe("Anniversary");
      expect((await prisma.lifeEvent.findUniqueOrThrow({ where: { id: event.id } })).title).toBe("Moved home");
    });
  });

  describe("a fact", () => {
    it("keeps the category the form names and drops the one it clears", async () => {
      const [books, food] = await Promise.all([
        prisma.taxonomyTerm.findFirstOrThrow({
          where: { ownerId, kind: "FACT_CATEGORY" },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.taxonomyTerm.findFirstOrThrow({
          where: { ownerId, kind: "FACT_CATEGORY" },
          orderBy: { sortOrder: "desc" },
        }),
      ]);

      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Reads le Carré", categoryId: books.id },
      });

      expect(
        await updateFact(form({ id: fact.id, content: "Reads le Carré", categoryId: food.id })),
      ).toMatchObject({ ok: true });
      expect(
        (await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).categoryId,
      ).toBe(food.id);

      await updateFact(form({ id: fact.id, content: "Reads le Carré" }));
      expect(
        (await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).categoryId,
      ).toBeNull();
    });

    it("refuses a category belonging to another account", async () => {
      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Reads le Carré" },
      });
      const theirCategory = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId: strangerId, kind: "FACT_CATEGORY" },
      });

      // An id that resolves to somebody else's term would render the row with
      // a label that was never theirs to use.
      expect(
        await updateFact(
          form({ id: fact.id, content: "Reads le Carré", categoryId: theirCategory.id }),
        ),
      ).toMatchObject({ ok: false });
      expect(
        (await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).categoryId,
      ).toBeNull();
    });

    it("refuses one of its own terms filed under the wrong kind", async () => {
      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Reads le Carré" },
      });
      const giftOccasion = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "GIFT_OCCASION" },
      });

      expect(
        await updateFact(
          form({ id: fact.id, content: "Reads le Carré", categoryId: giftOccasion.id }),
        ),
      ).toMatchObject({ ok: false });
    });

    it("refuses someone else's row rather than reporting a save that never happened", async () => {
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      const fact = await prisma.fact.create({
        data: { ownerId: strangerId, contactId: theirs.id, content: "Not yours" },
      });

      expect(await updateFact(form({ id: fact.id, content: "Mine now" }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).content).toBe(
        "Not yours",
      );
    });

    it("is out of reach while the lock is closed, not merely hidden", async () => {
      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Sees a therapist", isPrivate: true },
      });

      state.enabled = true;
      state.unlocked = false;

      expect(await updateFact(form({ id: fact.id, content: "Rewritten" }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).content).toBe(
        "Sees a therapist",
      );
    });

    it("will not hide a visible row while the lock is closed", async () => {
      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Hates surprises" },
      });

      state.enabled = true;
      state.unlocked = false;

      // Hiding it now would put it somewhere this session cannot reach to
      // put it back — the same reason `setPrivate` demands the PIN first.
      expect(
        await updateFact(form({ id: fact.id, content: "Hates surprises", isPrivate: "true" })),
      ).toMatchObject({ ok: false });
      expect((await prisma.fact.findUniqueOrThrow({ where: { id: fact.id } })).isPrivate).toBe(
        false,
      );
    });

    it("edits a visible row while locked as long as the marker does not move", async () => {
      const fact = await prisma.fact.create({
        data: { ownerId, contactId: sarahId, content: "Hates surprises" },
      });

      state.enabled = true;
      state.unlocked = false;

      expect(await updateFact(form({ id: fact.id, content: "Hates surprises, mostly" }))).toMatchObject(
        { ok: true },
      );
    });
  });

  // --- follow-ups ----------------------------------------------------------

  describe("a follow-up", () => {
    it("clears a due date the picker was emptied of", async () => {
      const task = await prisma.task.create({
        data: {
          ownerId,
          contactId: sarahId,
          title: "Send the recipe",
          dueDate: new Date("2026-09-01T00:00:00Z"),
          priority: "HIGH",
        },
      });

      expect(await updateTask(form({ id: task.id, title: "Send the recipe" }))).toMatchObject({
        ok: true,
      });

      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(stored.dueDate).toBeNull();
      // Priority falls back to NORMAL rather than sticking at HIGH: the form
      // carries a select, so an absent value means the user chose nothing.
      expect(stored.priority).toBe("NORMAL");
    });

    it("leaves the completion mark alone — that is what the checkbox is for", async () => {
      const completedAt = new Date("2026-08-01T12:00:00Z");
      const task = await prisma.task.create({
        data: { ownerId, contactId: sarahId, title: "Book the table", completedAt },
      });

      await updateTask(form({ id: task.id, title: "Book the table for four" }));

      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(stored.title).toBe("Book the table for four");
      expect(stored.completedAt).toEqual(completedAt);
    });
  });

  // --- ideas ---------------------------------------------------------------

  it("an idea keeps its status when its wording is fixed", async () => {
    const idea = await prisma.idea.create({
      data: { ownerId, contactId: sarahId, content: "Ask about the startre", status: "USED" },
    });

    expect(
      await updateIdea(form({ id: idea.id, content: "Ask about the sourdough starter" })),
    ).toMatchObject({ ok: true });

    const stored = await prisma.idea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(stored.content).toBe("Ask about the sourdough starter");
    expect(stored.status).toBe("USED");
  });

  // --- gifts ---------------------------------------------------------------

  it("a gift edited without a status keeps the one it had", async () => {
    const gift = await prisma.gift.create({
      data: { ownerId, contactId: sarahId, name: "Banneton", status: "GIVEN" },
    });

    // An edit that reset every gift to IDEA on save would un-give things
    // already handed over.
    await updateGift(form({ id: gift.id, name: "Banneton proofing basket" }));

    const stored = await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } });
    expect(stored.name).toBe("Banneton proofing basket");
    expect(stored.status).toBe("GIVEN");
  });

  it("a gift refuses an occasion belonging to another account", async () => {
    const gift = await prisma.gift.create({ data: { ownerId, contactId: sarahId, name: "Book" } });
    const theirOccasion = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId: strangerId, kind: "GIFT_OCCASION" },
    });

    expect(
      await updateGift(form({ id: gift.id, name: "Book", occasionId: theirOccasion.id })),
    ).toMatchObject({ ok: false });
    expect(
      (await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } })).occasionId,
    ).toBeNull();
  });

  it("a gift price is stored in cents, not whatever the box said", async () => {
    const gift = await prisma.gift.create({ data: { ownerId, contactId: sarahId, name: "Book" } });

    await updateGift(form({ id: gift.id, name: "Book", price: "42.50", status: "PURCHASED" }));

    const stored = await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } });
    expect(stored.priceCents).toBe(4250);
    expect(stored.status).toBe("PURCHASED");
  });

  // --- debts ---------------------------------------------------------------

  describe("a debt", () => {
    it("turns round when the direction was recorded backwards", async () => {
      const debt = await prisma.debt.create({
        data: {
          ownerId,
          contactId: sarahId,
          direction: "THEY_OWE_ME",
          description: "Covered dinner",
          amountCents: 4200,
          incurredOn: new Date("2026-08-01T00:00:00Z"),
        },
      });

      await updateDebt(
        form({
          id: debt.id,
          description: "Covered dinner",
          direction: "I_OWE_THEM",
          amount: "42",
          incurredOn: "2026-08-01",
        }),
      );

      const stored = await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
      expect(stored.direction).toBe("I_OWE_THEM");
      expect(stored.amountCents).toBe(4200);
    });

    it("leaves the settlement alone — settling is its own act", async () => {
      const settledOn = new Date("2026-08-20T00:00:00Z");
      const debt = await prisma.debt.create({
        data: {
          ownerId,
          contactId: sarahId,
          direction: "THEY_OWE_ME",
          description: "Lent a drill",
          incurredOn: new Date("2026-08-01T00:00:00Z"),
          settledOn,
        },
      });

      await updateDebt(form({ id: debt.id, description: "Lent the cordless drill" }));

      const stored = await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
      expect(stored.description).toBe("Lent the cordless drill");
      expect(stored.settledOn).toEqual(settledOn);
    });

    it("refuses a start date later than the day it was settled", async () => {
      const debt = await prisma.debt.create({
        data: {
          ownerId,
          contactId: sarahId,
          direction: "THEY_OWE_ME",
          description: "Covered dinner",
          incurredOn: new Date("2026-08-01T00:00:00Z"),
          settledOn: new Date("2026-08-10T00:00:00Z"),
        },
      });

      // The mirror of settling before the debt began: nonsense in any later
      // report, and far more likely a typo than a story worth keeping.
      expect(
        await updateDebt(
          form({ id: debt.id, description: "Covered dinner", incurredOn: "2026-09-01" }),
        ),
      ).toMatchObject({ ok: false });
      expect(
        (await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } })).incurredOn,
      ).toEqual(new Date("2026-08-01T00:00:00Z"));
    });

    it("is out of reach while the lock is closed", async () => {
      const debt = await prisma.debt.create({
        data: {
          ownerId,
          contactId: sarahId,
          direction: "I_OWE_THEM",
          description: "The loan",
          incurredOn: new Date("2026-08-01T00:00:00Z"),
          isPrivate: true,
        },
      });

      state.enabled = true;
      state.unlocked = false;

      expect(await updateDebt(form({ id: debt.id, description: "Rewritten" }))).toMatchObject({
        ok: false,
      });
    });
  });

  // --- dietary needs -------------------------------------------------------

  it("a dietary need can move between kinds without being retyped", async () => {
    const need = await prisma.dietaryNeed.create({
      data: { ownerId, contactId: sarahId, kind: "PREFERENCE", label: "Shellfish" },
    });

    // The two ways of getting this wrong do not cost the same: a preference
    // that turns out to be an allergy has to be able to become one.
    await updateDietaryNeed(
      form({ id: need.id, label: "Shellfish", kind: "ALLERGY", carriesEpinephrine: "true" }),
    );

    const stored = await prisma.dietaryNeed.findUniqueOrThrow({ where: { id: need.id } });
    expect(stored.kind).toBe("ALLERGY");
    expect(stored.carriesEpinephrine).toBe(true);
  });

  // --- flags ---------------------------------------------------------------

  it("a flag can be reconsidered from red to green, keeping its wording", async () => {
    const flag = await prisma.flag.create({
      data: { ownerId, contactId: sarahId, kind: "RED", text: "Direct to the point of blunt" },
    });

    await updateFlag(
      form({ id: flag.id, kind: "GREEN", text: "Direct to the point of blunt", severity: "1" }),
    );

    const stored = await prisma.flag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(stored.kind).toBe("GREEN");
    expect(stored.text).toBe("Direct to the point of blunt");
    expect(stored.severity).toBe(1);
  });

  it("a flag is not editable while the lock is closed", async () => {
    const flag = await prisma.flag.create({
      data: { ownerId, contactId: sarahId, kind: "RED", text: "Cancels a lot" },
    });

    state.enabled = true;
    state.unlocked = false;

    expect(await updateFlag(form({ id: flag.id, kind: "GREEN", text: "Cancels a lot" }))).toMatchObject(
      { ok: false },
    );
    expect((await prisma.flag.findUniqueOrThrow({ where: { id: flag.id } })).kind).toBe("RED");
  });

  // --- relationships -------------------------------------------------------

  describe("a relationship", () => {
    async function relationshipType(slug: string) {
      return prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "RELATIONSHIP_TYPE", slug },
      });
    }

    it("moves both halves, so the reciprocal does not keep the old word", async () => {
      const [parent, sibling] = await Promise.all([
        relationshipType("parent"),
        relationshipType("sibling"),
      ]);

      await prisma.relationship.createMany({
        data: [
          {
            ownerId,
            fromContactId: sarahId,
            toContactId: marcusId,
            typeId: parent.id,
            pairId: "pair0001",
          },
          {
            ownerId,
            fromContactId: marcusId,
            toContactId: sarahId,
            typeId: parent.inverseTermId ?? parent.id,
            pairId: "pair0001",
          },
        ],
      });

      const row = await prisma.relationship.findFirstOrThrow({
        where: { ownerId, fromContactId: sarahId, toContactId: marcusId },
      });

      expect(await updateRelationship(form({ id: row.id, typeId: sibling.id }))).toMatchObject({
        ok: true,
      });

      const rows = await prisma.relationship.findMany({
        where: { ownerId, pairId: "pair0001" },
        include: { type: true },
      });
      expect(rows).toHaveLength(2);
      // Sibling is its own inverse, so both halves land on it.
      expect(rows.map((r) => r.type.slug).sort()).toEqual(["sibling", "sibling"]);
    });

    it("refuses a type the account does not have", async () => {
      const parent = await relationshipType("parent");
      const row = await prisma.relationship.create({
        data: {
          ownerId,
          fromContactId: sarahId,
          toContactId: marcusId,
          typeId: parent.id,
          pairId: "pair0002",
        },
      });

      expect(await updateRelationship(form({ id: row.id, typeId: "not-a-term" }))).toMatchObject({
        ok: false,
      });
      expect(await prisma.relationship.count({ where: { ownerId } })).toBe(1);
    });
  });
});
