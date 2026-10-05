import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, holdUncommitted, prisma, reset } from "./db";

/**
 * Noting news about the people in a friend's life while logging the
 * conversation it came up in.
 *
 * Run through the real actions, because what is worth guarding is what the
 * form cannot promise: that the news is heard from someone who was there, and
 * visible; that it lands only on someone in *that* friend's life; that it is
 * dated to the conversation in the owner's timezone; that the lock hides it
 * wherever it hides the conversation; and that deleting a conversation the
 * lock would hide does not leave its notes behind with nothing hiding them.
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
  recordProtectedReadActivity: async () => {},
  requireUnlocked: async () =>
    state.enabled && !state.unlocked
      ? { ok: false, error: "Unlock to continue." }
      : { ok: true },
}));

const {
  createInteraction,
  deleteInteraction,
  loadAssociateMentionOptions,
  loadInteractionForEdit,
  updateInteraction,
} = await import("@/server/actions/interactions");
const { promoteAssociate } = await import("@/server/actions/details");
const { askAboutForContact, getAssociate } = await import("@/server/queries/associates");
const { plainDateFromDb } = await import("@/lib/dates");

function form(values: Record<string, string | string[] | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe.skipIf(!hasTestDatabase)("people they talked about, noted while logging", () => {
  let ownerId = "";
  let strangerId = "";
  let aliceId = "";
  let carolId = "";
  let hiddenId = "";
  let bobId = "";
  let friendTypeId = "";

  beforeEach(async () => {
    await reset();
    ownerId = (await createTestUser()).id;
    strangerId = (await createTestUser()).id;
    state.ownerId = ownerId;
    state.enabled = false;
    state.unlocked = true;

    aliceId = (await prisma.contact.create({ data: { ownerId, firstName: "Alice" } })).id;
    carolId = (await prisma.contact.create({ data: { ownerId, firstName: "Carol" } })).id;
    hiddenId = (
      await prisma.contact.create({ data: { ownerId, firstName: "Hidden", isPrivate: true } })
    ).id;
    bobId = (
      await prisma.associate.create({
        data: { ownerId, name: "Bob", links: { create: { contactId: aliceId, howTheyKnow: "Colleague" } } },
      })
    ).id;
    friendTypeId = (
      await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "RELATIONSHIP_TYPE" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(() => prisma.$disconnect());

  function lock() {
    state.enabled = true;
    state.unlocked = false;
  }

  async function log(
    mentions: unknown[],
    over: Record<string, string | string[] | undefined> = {},
  ) {
    return createInteraction(
      form({
        contactIds: [aliceId],
        // 01:30 UTC on the 5th is the evening of the 4th in New York.
        occurredAt: "2026-10-05T01:30:00.000Z",
        title: "Coffee",
        associateMentions: JSON.stringify(mentions),
        ...over,
      }),
    );
  }

  describe("writing it", () => {
    it("notes news about someone already in the friend's life, dated to the conversation in the owner's timezone", async () => {
      const result = await log([
        { associateId: bobId, heardFromContactId: aliceId, content: "Started night shifts" },
      ]);
      expect(result.ok).toBe(true);

      const [note] = await prisma.associateNote.findMany({ where: { associateId: bobId } });
      expect(note).toMatchObject({
        kind: "UPDATE",
        content: "Started night shifts",
        heardFromContactId: aliceId,
        sourceInteractionId: result.data!.id,
        precision: "DAY",
      });
      expect(plainDateFromDb(note!.date!)).toEqual({ year: 2026, month: 10, day: 4 });
    });

    it("adds someone new to the life of the friend who told you", async () => {
      await log([{ name: "Priya", heardFromContactId: aliceId, content: "Alice's new boss" }]);

      const priya = await prisma.associate.findFirstOrThrow({
        where: { ownerId, name: "Priya" },
        include: { links: true, notes: true },
      });
      expect(priya.links.map((link) => link.contactId)).toEqual([aliceId]);
      expect(priya.notes.map((n) => [n.content, n.heardFromContactId])).toEqual([
        ["Alice's new boss", aliceId],
      ]);
    });

    it("lets each line name which of several people said it", async () => {
      await prisma.associateLink.create({ data: { ownerId, associateId: bobId, contactId: carolId } });
      await log(
        [
          { associateId: bobId, heardFromContactId: aliceId, content: "From Alice" },
          { associateId: bobId, heardFromContactId: carolId, content: "From Carol" },
        ],
        { contactIds: [aliceId, carolId] },
      );

      const notes = await prisma.associateNote.findMany({ where: { associateId: bobId } });
      expect(notes.map((n) => [n.content, n.heardFromContactId]).sort()).toEqual(
        [
          ["From Alice", aliceId],
          ["From Carol", carolId],
        ].sort(),
      );
    });

    it("puts the news on that friend's Ask about card", async () => {
      await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Started night shifts" }]);

      const ask = await askAboutForContact(ownerId, aliceId);
      expect(ask.items.map((item) => item.content)).toEqual(["Started night shifts"]);
      expect((await getAssociate(ownerId, bobId))?.notes[0]?.fromConversation).toEqual({ label: "Coffee" });
    });

    it("writes nothing when no one was talked about", async () => {
      expect((await createInteraction(form({ contactIds: [aliceId], title: "Coffee" }))).ok).toBe(true);
      expect(await prisma.associateNote.count()).toBe(0);
    });
  });

  describe("refusing what the form cannot promise", () => {
    async function refused(mentions: unknown[], over: Record<string, string | string[] | undefined> = {}) {
      const result = await log(mentions, over);
      expect(result.ok).toBe(false);
      // All or nothing: a refused line does not leave a half-logged conversation.
      expect(await prisma.interaction.count({ where: { ownerId } })).toBe(0);
      expect(await prisma.associateNote.count()).toBe(0);
      return result;
    }

    it("a source who was not there", async () => {
      await prisma.associateLink.create({ data: { ownerId, associateId: bobId, contactId: carolId } });
      await refused([{ associateId: bobId, heardFromContactId: carolId, content: "x" }]);
    });

    it("someone not in the life of the friend who told you", async () => {
      await prisma.associateLink.deleteMany({ where: { associateId: bobId } });
      await prisma.associateLink.create({ data: { ownerId, associateId: bobId, contactId: carolId } });
      await refused([{ associateId: bobId, heardFromContactId: aliceId, content: "x" }]);
    });

    it("someone already tracked as a person", async () => {
      await promoteAssociate(form({ id: bobId, firstName: "Bob", typeId: friendTypeId }));
      const before = await prisma.interaction.count({ where: { ownerId } });
      const result = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "x" }]);
      expect(result.ok).toBe(false);
      expect(await prisma.interaction.count({ where: { ownerId } })).toBe(before);
    });

    it("another account's associate", async () => {
      const theirs = await prisma.contact.create({ data: { ownerId: strangerId, firstName: "N" } });
      const entry = await prisma.associate.create({
        data: { ownerId: strangerId, name: "Not yours", links: { create: { contactId: theirs.id } } },
      });
      await refused([{ associateId: entry.id, heardFromContactId: aliceId, content: "x" }]);
    });

    it("a hidden source while the lock is closed", async () => {
      await prisma.associateLink.create({ data: { ownerId, associateId: bobId, contactId: hiddenId } });
      lock();
      await refused(
        [{ associateId: bobId, heardFromContactId: hiddenId, content: "x" }],
        { contactIds: [aliceId, hiddenId] },
      );
    });

    it("both an existing person and a new name on one line, or neither", async () => {
      await refused([{ associateId: bobId, name: "Bob", heardFromContactId: aliceId, content: "x" }]);
      await refused([{ heardFromContactId: aliceId, content: "x" }]);
    });

    it("an empty line, an over-long one, and too many", async () => {
      await refused([{ associateId: bobId, heardFromContactId: aliceId, content: "   " }]);
      await refused([{ associateId: bobId, heardFromContactId: aliceId, content: "x".repeat(10_001) }]);
      await refused(
        Array.from({ length: 21 }, () => ({ associateId: bobId, heardFromContactId: aliceId, content: "x" })),
      );
    });

    it("a field that is not the JSON the form writes", async () => {
      const result = await createInteraction(
        form({ contactIds: [aliceId], associateMentions: "{not json" }),
      );
      expect(result.ok).toBe(false);
      expect(await prisma.interaction.count({ where: { ownerId } })).toBe(0);
    });

    it("someone promoted while the save was waiting on them", async () => {
      // Validated before the transaction opens; the lock taken inside it is
      // what notices the promotion that landed in between.
      const held = await holdUncommitted((tx) =>
        tx.$queryRaw`SELECT id FROM Associate WHERE id = ${bobId} FOR UPDATE`.then(() =>
          tx.associate.update({ where: { id: bobId }, data: { promotedContactId: carolId } }),
        ),
      );
      const logging = log([{ associateId: bobId, heardFromContactId: aliceId, content: "Late" }]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      held.release();
      await held.settled;

      expect(await logging).toMatchObject({ ok: false });
      expect(await prisma.associateNote.count()).toBe(0);
      expect(await prisma.interaction.count({ where: { ownerId } })).toBe(0);
    });
  });

  describe("editing the conversation", () => {
    it("adds new lines and leaves the ones already noted alone", async () => {
      const created = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "First" }]);
      const id = created.data!.id;

      const result = await updateInteraction(
        form({
          id,
          contactIds: [aliceId],
          occurredAt: "2026-10-05T01:30:00.000Z",
          title: "Coffee",
          associateMentions: JSON.stringify([
            { associateId: bobId, heardFromContactId: aliceId, content: "Second" },
          ]),
        }),
      );
      expect(result.ok).toBe(true);
      expect(
        (await prisma.associateNote.findMany({ where: { sourceInteractionId: id }, orderBy: { createdAt: "asc" } })).map(
          (n) => n.content,
        ),
      ).toEqual(["First", "Second"]);

      const loaded = await loadInteractionForEdit(id);
      expect(loaded.data?.associateNotes.map((n) => [n.associate.name, n.content, n.heardFrom])).toEqual([
        ["Bob", "First", "Alice"],
        ["Bob", "Second", "Alice"],
      ]);
    });
  });

  describe("the privacy lock", () => {
    it("hides a note heard in a private conversation, where it would show an ordinary one", async () => {
      const shown = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Ordinary" }]);
      const hidden = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Confided" }]);
      await prisma.interaction.update({ where: { id: hidden.data!.id }, data: { isPrivate: true } });
      expect(shown.ok).toBe(true);

      lock();
      expect((await getAssociate(ownerId, bobId))?.notes.map((n) => n.content)).toEqual(["Ordinary"]);
      expect((await askAboutForContact(ownerId, aliceId)).total).toBe(1);
    });

    it("hides a note from a conversation a private friend was at, though someone else said it", async () => {
      // The interaction fragment, taken whole: a group dinner with a private
      // friend at it is not read back through what Alice said there.
      await log(
        [{ associateId: bobId, heardFromContactId: aliceId, content: "At the dinner" }],
        { contactIds: [aliceId, hiddenId] },
      );

      lock();
      expect((await getAssociate(ownerId, bobId))?.notes).toEqual([]);
    });

    it("hides the notes on the edit sheet the same way", async () => {
      const created = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "x" }]);
      await prisma.associate.update({ where: { id: bobId }, data: { isPrivate: true } });
      lock();
      expect((await loadInteractionForEdit(created.data!.id)).data?.associateNotes).toEqual([]);
    });

    it("offers only visible people, and not those already tracked", async () => {
      await prisma.associate.create({
        data: { ownerId, name: "Secret", isPrivate: true, links: { create: { contactId: aliceId } } },
      });
      await prisma.associate.create({
        data: { ownerId, name: "Tracked", promotedContactId: carolId, links: { create: { contactId: aliceId } } },
      });
      await prisma.associate.create({
        data: { ownerId, name: "Dana", links: { create: { contactId: hiddenId } } },
      });

      const unlocked = await loadAssociateMentionOptions([aliceId, hiddenId]);
      expect(unlocked.data?.find((row) => row.contactId === aliceId)?.associates.map((a) => a.name)).toEqual([
        "Bob",
        "Secret",
      ]);

      lock();
      const locked = await loadAssociateMentionOptions([aliceId, hiddenId]);
      expect(locked.data).toEqual([{ contactId: aliceId, associates: [{ id: bobId, name: "Bob" }] }]);
    });
  });

  describe("deleting the conversation", () => {
    it("keeps the notes from an ordinary one", async () => {
      const created = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Kept" }]);
      expect(await deleteInteraction(created.data!.id)).toMatchObject({ ok: true });

      expect(await prisma.associateNote.findMany({ where: { associateId: bobId } })).toEqual([
        expect.objectContaining({ content: "Kept", sourceInteractionId: null }),
      ]);
    });

    it("takes the notes from one the lock would hide, which nothing would hide afterwards", async () => {
      const marked = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Marked" }]);
      await prisma.interaction.update({ where: { id: marked.data!.id }, data: { isPrivate: true } });
      const attended = await log(
        [{ associateId: bobId, heardFromContactId: aliceId, content: "Attended" }],
        { contactIds: [aliceId, hiddenId] },
      );

      await deleteInteraction(marked.data!.id);
      await deleteInteraction(attended.data!.id);
      expect(await prisma.associateNote.count({ where: { associateId: bobId } })).toBe(0);
    });
  });

  describe("promoting someone noted this way", () => {
    it("links each fact to its conversation, and keeps a confided one private", async () => {
      const ordinary = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Ordinary" }]);
      const confided = await log([{ associateId: bobId, heardFromContactId: aliceId, content: "Confided" }]);
      await prisma.interaction.update({ where: { id: confided.data!.id }, data: { isPrivate: true } });

      const person = await promoteAssociate(form({ id: bobId, firstName: "Bob", typeId: friendTypeId }));
      const facts = await prisma.fact.findMany({ where: { contactId: person.data!.contactId } });
      const byText = (text: string) => facts.find((fact) => fact.content.includes(text));
      expect(byText("Ordinary")).toMatchObject({ isPrivate: false, sourceInteractionId: ordinary.data!.id });
      expect(byText("Confided")).toMatchObject({ isPrivate: true, sourceInteractionId: confided.data!.id });
    });
  });
});
