import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, holdUncommitted, prisma, reset } from "./db";

/**
 * The people in your contacts' lives who are not tracked themselves.
 *
 * Run through the real actions rather than an imitation, because the parts
 * worth guarding are the parts an imitation leaves out: that one associate can
 * be in two friends' lives without being written down twice, that what one
 * friend told you is never presented as something another friend said, that
 * an entry is withheld for its own marker, for the person it became and for
 * being known only through private people, that a note heard from a private
 * friend is withheld with the lock closed, that promoting one twice produces
 * one person rather than two and carries every note across, and that deleting
 * a friend does not leave their colleague behind as a note about nobody.
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
  createAssociate,
  createAssociateNote,
  deleteAssociate,
  deleteAssociateNote,
  linkAssociate,
  mergeAssociates,
  promoteAssociate,
  unlinkAssociate,
  updateAssociate,
  updateAssociateLink,
  updateAssociateNote,
} = await import("@/server/actions/details");
const { deleteContact } = await import("@/server/actions/contacts");
const {
  askAboutForContact,
  askAboutForContacts,
  associatesForContact,
  getAssociate,
  linkableAssociates,
  listAssociateGroups,
  mergeCandidates,
} = await import("@/server/queries/associates");
const { listContacts } = await import("@/server/queries/contacts");
const { countPrivateRows } = await import("@/server/privacy/counts");
const { calendarDateInTz, plainDateFromDb } = await import("@/lib/dates");

/** FormData from a plain object, so each test reads as the form it stands for. */
function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe.skipIf(!hasTestDatabase)("people in their life", () => {
  let ownerId = "";
  let strangerId = "";
  let aliceId = "";
  let carolId = "";
  let hiddenId = "";
  let friendTypeId = "";

  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    ownerId = owner.id;
    strangerId = stranger.id;
    state.ownerId = ownerId;
    state.enabled = false;
    state.unlocked = true;

    aliceId = (
      await prisma.contact.create({ data: { ownerId, firstName: "Alice", lastName: "Chen" } })
    ).id;
    carolId = (await prisma.contact.create({ data: { ownerId, firstName: "Carol" } })).id;
    hiddenId = (
      await prisma.contact.create({ data: { ownerId, firstName: "Hidden", isPrivate: true } })
    ).id;

    const friend = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true },
    });
    friendTypeId = friend.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Lock the account, so a read has to prove it filters rather than hides. */
  function lock() {
    state.enabled = true;
    state.unlocked = false;
  }

  function unlock() {
    state.enabled = true;
    state.unlocked = true;
  }

  async function add(over: Record<string, string | undefined> = {}) {
    const result = await createAssociate(
      form({ contactId: aliceId, name: "Bob", howTheyKnow: "Colleague", ...over }),
    );
    if (!result.ok || !result.data) throw new Error(result.error ?? "create failed");
    return result.data.id;
  }

  async function note(associateId: string, over: Record<string, string | undefined> = {}) {
    const result = await createAssociateNote(
      form({ associateId, kind: "DETAIL", content: "Into climbing", ...over }),
    );
    if (!result.ok || !result.data) {
      throw new Error(result.error ?? JSON.stringify(result.fieldErrors));
    }
    return result.data.id;
  }

  /** An entry another account owns, written directly. */
  async function foreignEntry() {
    const theirs = await prisma.contact.create({
      data: { ownerId: strangerId, firstName: "Nobody" },
    });
    return prisma.associate.create({
      data: { ownerId: strangerId, name: "Not yours", links: { create: { contactId: theirs.id } } },
    });
  }

  describe("writing one down", () => {
    it("keeps the name, the connection and the first note, heard from that friend", async () => {
      const id = await add({ notes: "On night shifts until March." });

      const row = await prisma.associate.findUniqueOrThrow({
        where: { id },
        include: { links: true, notes: true },
      });
      expect(row).toMatchObject({ name: "Bob", promotedContactId: null });
      expect(row.links).toEqual([
        expect.objectContaining({ contactId: aliceId, howTheyKnow: "Colleague" }),
      ]);
      // Written on Alice's page, so Alice is where it came from.
      expect(row.notes).toEqual([
        expect.objectContaining({
          kind: "DETAIL",
          content: "On night shifts until March.",
          heardFromContactId: aliceId,
          date: null,
        }),
      ]);
    });

    it("writes no note when there is nothing to remember", async () => {
      const id = await add();
      expect(await prisma.associateNote.count({ where: { associateId: id } })).toBe(0);
    });

    it("refuses a nameless entry", async () => {
      expect(await createAssociate(form({ contactId: aliceId, name: "" }))).toMatchObject({
        ok: false,
      });
    });

    it("refuses another account's contact", async () => {
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });

      expect(
        await createAssociate(form({ contactId: theirs.id, name: "Bob" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(0);
    });

    it("refuses to write a hidden entry while the lock is closed", async () => {
      // It would land somewhere the writer cannot reach to undo it, and the
      // identical transition on an edit is refused a moment later.
      lock();

      expect(
        await createAssociate(form({ contactId: aliceId, name: "Bob", isPrivate: "true" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(0);
    });

    it("still writes an ordinary entry while the lock is closed", async () => {
      lock();

      expect(await createAssociate(form({ contactId: aliceId, name: "Bob" }))).toMatchObject({
        ok: true,
      });
    });

    it("refuses a private contact while the lock is closed", async () => {
      // An id remembered from an unlocked session is not a way to go on
      // writing to someone the lock is currently hiding.
      lock();
      expect(
        await createAssociate(form({ contactId: hiddenId, name: "Bob" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(0);
    });
  });

  describe("one person in two friends' lives", () => {
    it("links an existing entry instead of writing a second one", async () => {
      const id = await add();

      const result = await createAssociate(
        form({ contactId: carolId, associateId: id, howTheyKnow: "Climbing partner" }),
      );
      expect(result).toMatchObject({ ok: true, data: { id } });

      expect(await prisma.associate.count()).toBe(1);
      const links = await prisma.associateLink.findMany({
        where: { associateId: id },
        orderBy: { contactId: "asc" },
      });
      expect(links.map((link) => [link.contactId, link.howTheyKnow]).sort()).toEqual(
        [
          [aliceId, "Colleague"],
          [carolId, "Climbing partner"],
        ].sort(),
      );
    });

    it("links from the associate's own page too", async () => {
      const id = await add();
      expect(
        await linkAssociate(form({ associateId: id, contactId: carolId, howTheyKnow: "Gym" })),
      ).toMatchObject({ ok: true });
      expect(await prisma.associateLink.count({ where: { associateId: id } })).toBe(2);
    });

    it("offers an entry for linking only where it is not already linked", async () => {
      const id = await add();

      expect((await linkableAssociates(ownerId, aliceId)).items).toHaveLength(0);
      expect((await linkableAssociates(ownerId, carolId)).items).toEqual([
        { id, name: "Bob", knownTo: ["Alice Chen"] },
      ]);
    });

    it("does not offer an entry known only through a private person while locked", async () => {
      // The picker's own "not already linked here" condition is a `links`
      // clause, and spread beside the privacy fragment it replaced the
      // fragment's — so the name was offered from a page the lock does not gate.
      await add({ contactId: hiddenId, name: "Dana" });
      expect((await linkableAssociates(ownerId, carolId)).items).toHaveLength(1);

      lock();
      expect((await linkableAssociates(ownerId, carolId)).items).toEqual([]);
    });

    it("refuses to link another account's entry", async () => {
      const theirs = await foreignEntry();
      expect(
        await createAssociate(form({ contactId: aliceId, associateId: theirs.id })),
      ).toMatchObject({ ok: false });
      expect(await prisma.associateLink.count({ where: { contactId: aliceId } })).toBe(0);
    });

    it("keeps each friend's wording separate", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId, howTheyKnow: "Gym" }));

      expect(
        await updateAssociateLink(
          form({ associateId: id, contactId: carolId, howTheyKnow: "Climbing gym" }),
        ),
      ).toMatchObject({ ok: true });

      const [onAlice] = await associatesForContact(ownerId, aliceId);
      const [onCarol] = await associatesForContact(ownerId, carolId);
      expect(onAlice.howTheyKnow).toBe("Colleague");
      expect(onCarol.howTheyKnow).toBe("Climbing gym");
      expect(onAlice.alsoKnownTo).toEqual([{ id: carolId, name: "Carol" }]);
    });

    it("lists a shared entry under each friend on the roll-up", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));

      const groups = (await listAssociateGroups(ownerId)).items;
      expect(groups.map((group) => group.contact.id).sort()).toEqual([aliceId, carolId].sort());
      expect(groups.every((group) => group.entries[0]?.id === id)).toBe(true);
    });
  });

  describe("who told you", () => {
    it("splits what this friend told you from what you heard elsewhere", async () => {
      // The reason the feature exists: on Carol's page, what Alice told you
      // about Bob is shown apart, so it is not raised with someone who may
      // never have heard it.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      await note(id, { content: "Got promoted", kind: "UPDATE", heardFromContactId: aliceId });
      await note(id, { content: "Loves bouldering", heardFromContactId: carolId });
      await note(id, { content: "Told me himself he's moving" });

      const [onCarol] = await associatesForContact(ownerId, carolId);
      expect(onCarol.heardHere.map((n) => n.content)).toEqual(["Loves bouldering"]);
      expect(onCarol.heardElsewhere.map((n) => [n.content, n.heardFrom?.name ?? null]).sort()).toEqual(
        [
          ["Got promoted", "Alice Chen"],
          ["Told me himself he's moving", null],
        ].sort(),
      );

      const [onAlice] = await associatesForContact(ownerId, aliceId);
      expect(onAlice.heardHere.map((n) => n.content)).toEqual(["Got promoted"]);
    });

    it("refuses a source who does not know them", async () => {
      // Carol is not linked: "Carol told me" about someone not in her life is
      // almost certainly a mis-pick, and would put the note on her page.
      const id = await add();
      const result = await createAssociateNote(
        form({ associateId: id, kind: "DETAIL", content: "x", heardFromContactId: carolId }),
      );
      expect(result).toMatchObject({ ok: false, fieldErrors: { heardFromContactId: expect.any(String) } });
      expect(await prisma.associateNote.count()).toBe(0);
    });

    it("refuses another account's contact as a source", async () => {
      const id = await add();
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      expect(
        await createAssociateNote(
          form({ associateId: id, kind: "DETAIL", content: "x", heardFromContactId: theirs.id }),
        ),
      ).toMatchObject({ ok: false });
    });

    it("keeps a note's source through an edit after that friend was unlinked", async () => {
      // Otherwise every note a friend told you would become uneditable the
      // moment they stopped being linked — or be re-attributed on save.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      const noteId = await note(id, { heardFromContactId: carolId });
      await unlinkAssociate(id, carolId);

      expect(
        await updateAssociateNote(
          form({ id: noteId, kind: "DETAIL", content: "Into trad climbing", heardFromContactId: carolId }),
        ),
      ).toMatchObject({ ok: true });
      expect(await prisma.associateNote.findUniqueOrThrow({ where: { id: noteId } })).toMatchObject({
        content: "Into trad climbing",
        heardFromContactId: carolId,
      });
    });
  });

  describe("notes", () => {
    it("dates an update left blank as today in the owner's timezone", async () => {
      const id = await add();
      const noteId = await note(id, { kind: "UPDATE", content: "Started night shifts" });

      const row = await prisma.associateNote.findUniqueOrThrow({ where: { id: noteId } });
      expect(row.precision).toBe("DAY");
      expect(plainDateFromDb(row.date!)).toEqual(calendarDateInTz(new Date(), TZ));
    });

    it("keeps a partial date partial", async () => {
      const id = await add();
      const noteId = await note(id, {
        kind: "UPDATE",
        content: "Moved to Leeds",
        date: "2026-03-14",
        datePrecision: "MONTH",
      });
      const row = await prisma.associateNote.findUniqueOrThrow({ where: { id: noteId } });
      expect(row.precision).toBe("MONTH");
      expect(plainDateFromDb(row.date!)).toEqual({ year: 2026, month: 3, day: 1 });
    });

    it("refuses an update with no year", async () => {
      const id = await add();
      expect(
        await createAssociateNote(
          form({
            associateId: id,
            kind: "UPDATE",
            content: "x",
            date: "2026-03-14",
            datePrecision: "MONTH_DAY",
          }),
        ),
      ).toMatchObject({ ok: false, fieldErrors: { date: expect.any(String) } });
    });

    it("carries no date on a detail", async () => {
      const id = await add();
      const noteId = await note(id, { date: "2026-03-14" });
      expect((await prisma.associateNote.findUniqueOrThrow({ where: { id: noteId } })).date).toBeNull();
    });

    it("refuses an empty note and an unknown kind", async () => {
      const id = await add();
      expect(
        await createAssociateNote(form({ associateId: id, kind: "DETAIL", content: "  " })),
      ).toMatchObject({ ok: false });
      expect(
        await createAssociateNote(form({ associateId: id, kind: "RUMOUR", content: "x" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.associateNote.count()).toBe(0);
    });

    it("refuses a note on another account's entry", async () => {
      const theirs = await foreignEntry();
      expect(
        await createAssociateNote(form({ associateId: theirs.id, kind: "DETAIL", content: "x" })),
      ).toMatchObject({ ok: false });
    });

    it("deletes one note and leaves the rest", async () => {
      const id = await add();
      const first = await note(id, { content: "One" });
      await note(id, { content: "Two" });

      expect(await deleteAssociateNote(first)).toMatchObject({ ok: true });
      expect(
        (await prisma.associateNote.findMany({ where: { associateId: id } })).map((n) => n.content),
      ).toEqual(["Two"]);
    });
  });

  describe("correcting one", () => {
    it("clears a connection the form no longer names rather than keeping it", async () => {
      // The shared-fields trap: a field present only in the add form is a
      // field an edit silently leaves behind, because the action writes what
      // it finds in the whole form.
      const id = await add();

      expect(
        await updateAssociate(form({ id, contactId: aliceId, name: "Bob" })),
      ).toMatchObject({ ok: true });
      expect(
        (
          await prisma.associateLink.findUniqueOrThrow({
            where: { associateId_contactId: { associateId: id, contactId: aliceId } },
          })
        ).howTheyKnow,
      ).toBeNull();
    });

    it("refuses someone else's row rather than reporting a save that never happened", async () => {
      const entry = await foreignEntry();

      expect(await updateAssociate(form({ id: entry.id, name: "Mine now" }))).toMatchObject({
        ok: false,
      });
      expect(
        (await prisma.associate.findUniqueOrThrow({ where: { id: entry.id } })).name,
      ).toBe("Not yours");
    });

    it("is out of reach while the lock is closed, not merely hidden", async () => {
      const id = await add({ isPrivate: "true" });
      lock();

      expect(await updateAssociate(form({ id, name: "Robert" }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.associate.findUniqueOrThrow({ where: { id } })).name).toBe("Bob");
    });

    it("will not hide a visible row while the lock is closed", async () => {
      // Marking one private while locked would make it vanish with no way back
      // to it without the PIN.
      const id = await add();
      lock();

      expect(
        await updateAssociate(form({ id, name: "Bob", isPrivate: "true" })),
      ).toMatchObject({ ok: false });
      expect((await prisma.associate.findUniqueOrThrow({ where: { id } })).isPrivate).toBe(
        false,
      );
    });

    it("edits a visible row while locked as long as the marker does not move", async () => {
      const id = await add();
      lock();

      expect(await updateAssociate(form({ id, name: "Robert" }))).toMatchObject({ ok: true });
      expect((await prisma.associate.findUniqueOrThrow({ where: { id } })).name).toBe(
        "Robert",
      );
    });
  });

  describe("the privacy lock", () => {
    it("withholds an entry marked private on an ordinary person", async () => {
      await add({ isPrivate: "true" });
      await add({ name: "Priya" });

      expect((await listAssociateGroups(ownerId)).items[0]?.entries).toHaveLength(2);
      lock();
      const locked = await listAssociateGroups(ownerId);
      expect(locked.items.flatMap((group) => group.entries).map((entry) => entry.name)).toEqual(
        ["Priya"],
      );
    });

    it("withholds an unmarked entry known only through a private person", async () => {
      const id = await add({ contactId: hiddenId, name: "Dana" });

      expect((await listAssociateGroups(ownerId)).items).toHaveLength(1);
      lock();
      expect((await listAssociateGroups(ownerId)).items).toHaveLength(0);
      expect(await getAssociate(ownerId, id)).toBeNull();
    });

    it("keeps one known through a public and a private friend, without naming the private one", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId, howTheyKnow: "Ex" }));
      lock();

      const detail = await getAssociate(ownerId, id);
      expect(detail?.links.map((link) => link.contact.id)).toEqual([aliceId]);
      const [onAlice] = await associatesForContact(ownerId, aliceId);
      expect(onAlice.alsoKnownTo).toEqual([]);
      // Neither the roll-up nor a direct read of the private friend's page.
      expect(
        (await listAssociateGroups(ownerId)).items.map((group) => group.contact.id),
      ).toEqual([aliceId]);
      expect(await associatesForContact(ownerId, hiddenId)).toEqual([]);
    });

    it("withholds a note heard from a private friend, and the count that would betray it", async () => {
      // The rule a note adds: it has no marker of its own, but "Hidden told
      // you" names Hidden — and what a private friend confided is theirs.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      await note(id, { content: "Public thing", heardFromContactId: aliceId });
      await note(id, { content: "Secret thing", heardFromContactId: hiddenId });

      expect((await getAssociate(ownerId, id))?.notes).toHaveLength(2);
      lock();

      expect((await getAssociate(ownerId, id))?.notes.map((n) => n.content)).toEqual([
        "Public thing",
      ]);
      const [onAlice] = await associatesForContact(ownerId, aliceId);
      expect([...onAlice.heardHere, ...onAlice.heardElsewhere].map((n) => n.content)).toEqual([
        "Public thing",
      ]);
      const [group] = (await listAssociateGroups(ownerId)).items;
      expect(group.entries[0]?.noteCount).toBe(1);

      unlock();
      const [opened] = (await listAssociateGroups(ownerId)).items;
      expect(opened.entries[0]?.noteCount).toBe(2);
    });

    it("cannot reach a note heard from a private friend while locked", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      const secret = await note(id, { content: "Secret", heardFromContactId: hiddenId });
      lock();

      expect(
        await updateAssociateNote(form({ id: secret, kind: "DETAIL", content: "Overwritten" })),
      ).toMatchObject({ ok: false });
      expect(await deleteAssociateNote(secret)).toMatchObject({ ok: false });
      expect((await prisma.associateNote.findUniqueOrThrow({ where: { id: secret } })).content).toBe(
        "Secret",
      );
    });

    it("refuses to delete an entry while the lock hides part of it", async () => {
      // Deleting it would destroy a note the person deleting cannot see.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      await note(id, { content: "Secret", heardFromContactId: hiddenId });
      lock();

      expect(await deleteAssociate(id)).toMatchObject({ ok: false });
      expect(await prisma.associate.count({ where: { id } })).toBe(1);
    });

    it("keeps an ordinary entry on an ordinary person in both states", async () => {
      // The control. An empty fragment must widen nothing rather than match
      // nothing — the inversion that once emptied a whole list for exactly the
      // accounts entitled to see all of it.
      await add();

      expect((await listAssociateGroups(ownerId)).items).toHaveLength(1);
      lock();
      expect((await listAssociateGroups(ownerId)).items).toHaveLength(1);
    });

    it("never serialises a private entry into the person's page payload", async () => {
      await add({ isPrivate: "true" });
      lock();

      expect(await associatesForContact(ownerId, aliceId)).toHaveLength(0);
    });

    it("does not surface someone through a private entry's name in search", async () => {
      await add({ name: "Zoltan", isPrivate: "true" });
      lock();

      // Finding Alice by searching a name only a hidden note carries would
      // answer "is something hidden here, and about whom" from a page the lock
      // does not gate.
      expect((await listContacts(ownerId, { search: "Zoltan" }, TZ)).items).toHaveLength(0);
    });

    it("does surface someone through an ordinary entry's name", async () => {
      await add({ name: "Zoltan" });

      const found = await listContacts(ownerId, { search: "Zoltan" }, TZ);
      expect(found.items.map((contact) => contact.id)).toEqual([aliceId]);
    });

    it("counts a private entry as something that must not be cached offline", async () => {
      // A model gaining isPrivate without joining that count leaves caching
      // switched on and the private row written to disk by the service worker.
      const before = await countPrivateRows(prisma, ownerId);
      await add({ isPrivate: "true" });
      expect(await countPrivateRows(prisma, ownerId)).toBe(before + 1);
    });

    it("leaves an ordinary entry out of the offline count", async () => {
      const before = await countPrivateRows(prisma, ownerId);
      await add();
      expect(await countPrivateRows(prisma, ownerId)).toBe(before);
    });
  });

  describe("what to ask a friend about", () => {
    async function update(associateId: string, content: string, date: string, source = aliceId) {
      return note(associateId, { kind: "UPDATE", content, date, heardFromContactId: source });
    }

    it("offers only the news this friend told you, newest first", async () => {
      // The whole point: what Carol told you, what Bob said himself, and a
      // standing detail are none of them things to raise with Alice.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      await update(id, "Started night shifts", "2026-09-12");
      await update(id, "Got promoted", "2026-10-01");
      await update(id, "Moving to Leeds", "2026-09-20", carolId);
      await note(id, { kind: "UPDATE", content: "Told me himself", date: "2026-10-02" });
      await note(id, { content: "Has two kids", heardFromContactId: aliceId });

      const ask = await askAboutForContact(ownerId, aliceId);
      expect(ask.items.map((item) => item.content)).toEqual(["Got promoted", "Started night shifts"]);
      expect(ask.total).toBe(2);
      expect(ask.items[0]).toMatchObject({
        associate: { id, name: "Bob", href: `/people/friends/${id}` },
        howTheyKnow: "Colleague",
        date: { year: 2026, month: 10, day: 1 },
        precision: "DAY",
      });

      expect((await askAboutForContact(ownerId, carolId)).items.map((item) => item.content)).toEqual([
        "Moving to Leeds",
      ]);
    });

    it("sorts by the date the news was as of, not by when it was typed", async () => {
      const id = await add();
      await update(id, "Newer news, typed first", "2026-10-01");
      await update(id, "Older news, typed later", "2026-08-01");

      expect((await askAboutForContact(ownerId, aliceId)).items.map((item) => item.content)).toEqual([
        "Newer news, typed first",
        "Older news, typed later",
      ]);
    });

    it("shows the newest three and counts the rest", async () => {
      const id = await add();
      for (const [content, date] of [
        ["One", "2026-01-01"],
        ["Two", "2026-02-01"],
        ["Three", "2026-03-01"],
        ["Four", "2026-04-01"],
      ]) {
        await update(id, content, date);
      }

      const ask = await askAboutForContact(ownerId, aliceId);
      expect(ask.items.map((item) => item.content)).toEqual(["Four", "Three", "Two"]);
      expect(ask.total).toBe(4);
    });

    it("drops someone no longer in this friend's life", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      await update(id, "Started night shifts", "2026-09-12");
      await unlinkAssociate(id, aliceId);

      expect(await askAboutForContact(ownerId, aliceId)).toEqual({ items: [], total: 0 });
    });

    it("withholds a private associate while locked, from the list and the count", async () => {
      const shown = await add({ name: "Priya" });
      const hidden = await add({ isPrivate: "true" });
      await update(shown, "Visible news", "2026-09-01");
      await update(hidden, "Hidden news", "2026-09-02");

      expect((await askAboutForContact(ownerId, aliceId)).total).toBe(2);
      lock();
      const ask = await askAboutForContact(ownerId, aliceId);
      expect(ask.items.map((item) => item.content)).toEqual(["Visible news"]);
      expect(ask.total).toBe(1);
    });

    it("keeps an associate a private friend also knows, for the public friend who told you", async () => {
      // The associate fragment and the link condition both carry a `links`
      // key; spread side by side, one replaces the other. This is the case
      // that shows which survived.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      await update(id, "From Alice", "2026-09-01");
      lock();

      expect((await askAboutForContact(ownerId, aliceId)).items.map((item) => item.content)).toEqual([
        "From Alice",
      ]);
    });

    it("points at the person someone became once promoted", async () => {
      const id = await add();
      await update(id, "Started night shifts", "2026-09-12");
      const person = await promoteAssociate(form({ id, firstName: "Bob", lastName: "Ellis", typeId: friendTypeId }));

      const [item] = (await askAboutForContact(ownerId, aliceId)).items;
      expect(item?.associate).toMatchObject({
        name: "Bob Ellis",
        href: `/people/${person.data!.contactId}`,
      });
    });

    it("keeps the limit per friend when asked for several at once", async () => {
      // One capped query for everyone would let a talkative friend's notes
      // crowd out the rest.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      for (const day of ["01", "02", "03", "04"]) await update(id, `Alice ${day}`, `2026-09-${day}`);
      await update(id, "Carol's one", "2026-08-01", carolId);

      const all = await askAboutForContacts(ownerId, [aliceId, carolId, aliceId]);
      expect(all.size).toBe(2);
      expect(all.get(aliceId)?.items).toHaveLength(3);
      expect(all.get(carolId)?.items.map((item) => item.content)).toEqual(["Carol's one"]);
    });

    it("never reaches into another account", async () => {
      const id = await add();
      await update(id, "Started night shifts", "2026-09-12");

      expect(await askAboutForContact(strangerId, aliceId)).toEqual({ items: [], total: 0 });
    });
  });

  describe("taking one out of a friend's life", () => {
    it("removes the link and keeps the entry while someone else knows them", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      await note(id, { heardFromContactId: aliceId });

      expect(await unlinkAssociate(id, aliceId)).toMatchObject({ ok: true, data: { deleted: false } });
      expect(await prisma.associateLink.count({ where: { associateId: id } })).toBe(1);
      // Who told you is still true after they stop being the reason you know them.
      expect(await prisma.associateNote.count({ where: { associateId: id } })).toBe(1);
    });

    it("deletes the entry with its last link", async () => {
      const id = await add();
      await note(id);

      expect(await unlinkAssociate(id, aliceId)).toMatchObject({ ok: true, data: { deleted: true } });
      expect(await prisma.associate.count()).toBe(0);
      expect(await prisma.associateNote.count()).toBe(0);
    });

    it("keeps the entry when only a hidden link remains", async () => {
      // Locked, the remaining link is invisible — but it is still a link, and
      // deleting the entry would destroy what the private friend knows.
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      lock();

      expect(await unlinkAssociate(id, aliceId)).toMatchObject({ ok: true, data: { deleted: false } });
      expect(await prisma.associate.count({ where: { id } })).toBe(1);
    });

    it("refuses another account's row", async () => {
      const entry = await foreignEntry();
      expect(await deleteAssociate(entry.id)).toMatchObject({ ok: false });
      expect(await prisma.associate.count({ where: { id: entry.id } })).toBe(1);
    });
  });

  describe("deleting a friend", () => {
    it("takes an associate known only through them", async () => {
      await add();
      expect(await deleteContact(aliceId)).toMatchObject({ ok: true });
      expect(await prisma.associate.count()).toBe(0);
    });

    it("leaves one someone else knows, and deletes only what that friend told you", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));
      await note(id, { content: "From Alice", heardFromContactId: aliceId });
      await note(id, { content: "From Carol", heardFromContactId: carolId });

      await deleteContact(aliceId);

      const row = await prisma.associate.findUniqueOrThrow({
        where: { id },
        include: { links: true, notes: true },
      });
      expect(row.links.map((link) => link.contactId)).toEqual([carolId]);
      // CASCADE, not SET NULL: re-attributing Alice's words to nobody would
      // present them as something Carol could safely hear.
      expect(row.notes.map((n) => n.content)).toEqual(["From Carol"]);
    });
  });

  describe("the same person, written down twice", () => {
    it("folds one into the other, keeping every link and note", async () => {
      const keep = await add({ notes: "Colleague of Alice" });
      const drop = await add({ contactId: carolId, name: "Bobby", howTheyKnow: "Gym", notes: "Climbs" });

      expect(await mergeAssociates(form({ keepId: keep, mergeId: drop }))).toMatchObject({ ok: true });

      expect(await prisma.associate.count({ where: { id: drop } })).toBe(0);
      const row = await prisma.associate.findUniqueOrThrow({
        where: { id: keep },
        include: { links: true, notes: true },
      });
      expect(row.name).toBe("Bob");
      expect(row.links.map((link) => [link.contactId, link.howTheyKnow]).sort()).toEqual(
        [
          [aliceId, "Colleague"],
          [carolId, "Gym"],
        ].sort(),
      );
      expect(row.notes.map((n) => [n.content, n.heardFromContactId]).sort()).toEqual(
        [
          ["Climbs", carolId],
          ["Colleague of Alice", aliceId],
        ].sort(),
      );
    });

    it("merges two links to the same friend into one, keeping the wording there is", async () => {
      const keep = await add({ howTheyKnow: "" });
      const drop = await add({ name: "Bobby", howTheyKnow: "Colleague" });

      await mergeAssociates(form({ keepId: keep, mergeId: drop }));

      const links = await prisma.associateLink.findMany({ where: { associateId: keep } });
      expect(links).toEqual([expect.objectContaining({ contactId: aliceId, howTheyKnow: "Colleague" })]);
    });

    it("keeps the merged entry private if either was", async () => {
      const keep = await add();
      const drop = await add({ name: "Bobby", isPrivate: "true" });

      await mergeAssociates(form({ keepId: keep, mergeId: drop }));
      expect((await prisma.associate.findUniqueOrThrow({ where: { id: keep } })).isPrivate).toBe(true);
    });

    it("takes the promotion across when only the dropped one had it", async () => {
      const keep = await add();
      const drop = await add({ name: "Bobby" });
      const person = await promoteAssociate(
        form({ id: drop, contactId: aliceId, firstName: "Bob", typeId: friendTypeId }),
      );

      await mergeAssociates(form({ keepId: keep, mergeId: drop }));
      expect(
        (await prisma.associate.findUniqueOrThrow({ where: { id: keep } })).promotedContactId,
      ).toBe(person.data!.contactId);
    });

    it("refuses two entries promoted into different people", async () => {
      const one = await add();
      const two = await add({ name: "Bobby" });
      await promoteAssociate(form({ id: one, firstName: "Bob", typeId: friendTypeId }));
      await promoteAssociate(form({ id: two, firstName: "Bobby", typeId: friendTypeId }));

      expect(await mergeAssociates(form({ keepId: one, mergeId: two }))).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(2);
      // And the picker does not offer what the action would refuse.
      const keep = await prisma.associate.findUniqueOrThrow({ where: { id: one } });
      expect((await mergeCandidates(ownerId, keep)).items).toEqual([]);
    });

    it("refuses an entry the lock is hiding", async () => {
      const keep = await add();
      const drop = await add({ name: "Bobby", isPrivate: "true" });
      lock();

      expect(await mergeAssociates(form({ keepId: keep, mergeId: drop }))).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(2);
    });

    it("refuses another account's entry", async () => {
      const keep = await add();
      const theirs = await foreignEntry();

      expect(await mergeAssociates(form({ keepId: keep, mergeId: theirs.id }))).toMatchObject({
        ok: false,
      });
      expect(await prisma.associate.count({ where: { id: theirs.id } })).toBe(1);
    });

    it("refuses an entry merged into itself", async () => {
      const keep = await add();
      expect(await mergeAssociates(form({ keepId: keep, mergeId: keep }))).toMatchObject({ ok: false });
      expect(await prisma.associate.count()).toBe(1);
    });
  });

  describe("promoting one into a person", () => {
    async function promote(id: string, over: Record<string, string | undefined> = {}) {
      return promoteAssociate(
        form({ id, firstName: "Bob", lastName: "Ellis", typeId: friendTypeId, ...over }),
      );
    }

    it("creates the person, copies every note as a fact, and links them both ways", async () => {
      const id = await add({ notes: "On night shifts." });
      await note(id, {
        kind: "UPDATE",
        content: "Got promoted",
        date: "2026-03-14",
        heardFromContactId: aliceId,
      });
      await note(id, { content: "Told me himself he climbs" });

      const result = await promote(id);
      expect(result.ok).toBe(true);
      const personId = result.data!.contactId;

      const person = await prisma.contact.findUniqueOrThrow({ where: { id: personId } });
      expect(person).toMatchObject({ firstName: "Bob", lastName: "Ellis", isPrivate: false });

      const facts = await prisma.fact.findMany({ where: { contactId: personId } });
      expect(facts.map((fact) => fact.content).sort()).toEqual(
        [
          "On night shifts. (heard from Alice Chen)",
          "Told me himself he climbs",
          "Mar 14, 2026: Got promoted (heard from Alice Chen)",
        ].sort(),
      );
      expect(facts.every((fact) => !fact.isPrivate)).toBe(true);

      const pair = await prisma.relationship.findMany({ where: { ownerId } });
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((row) => row.pairId)).size).toBe(1);
      expect(
        pair.map((row) => `${row.fromContactId}->${row.toContactId}`).sort(),
      ).toEqual([`${aliceId}->${personId}`, `${personId}->${aliceId}`].sort());

      // The entry is kept as a record, notes and all.
      const row = await prisma.associate.findUniqueOrThrow({ where: { id }, include: { notes: true } });
      expect(row.promotedContactId).toBe(personId);
      expect(row.notes).toHaveLength(3);
    });

    it("copies a note heard from a private friend as a private fact", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: hiddenId }));
      await note(id, { content: "Secret", heardFromContactId: hiddenId });

      const result = await promote(id, { contactId: aliceId });
      const [fact] = await prisma.fact.findMany({ where: { contactId: result.data!.contactId } });
      expect(fact).toMatchObject({ isPrivate: true });
    });

    it("asks which friend when there is more than one", async () => {
      const id = await add();
      await linkAssociate(form({ associateId: id, contactId: carolId }));

      expect(await promote(id)).toMatchObject({ ok: false, fieldErrors: { contactId: expect.any(String) } });
      const result = await promote(id, { contactId: carolId });
      const pair = await prisma.relationship.findMany({ where: { ownerId } });
      expect(pair.map((row) => row.fromContactId).sort()).toEqual(
        [carolId, result.data!.contactId].sort(),
      );
    });

    it("refuses a friend they are not linked to", async () => {
      const id = await add();
      expect(await promote(id, { contactId: carolId })).toMatchObject({ ok: false });
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(0);
    });

    it("stops being editable in place once promoted", async () => {
      const id = await add();
      await promote(id);

      expect(await updateAssociate(form({ id, name: "Robert" }))).toMatchObject({ ok: false });
      expect(await createAssociateNote(form({ associateId: id, kind: "DETAIL", content: "x" }))).toMatchObject({
        ok: false,
      });
      expect(await linkAssociate(form({ associateId: id, contactId: carolId }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.associate.findUniqueOrThrow({ where: { id } })).name).toBe("Bob");
    });

    it("makes one person, not two, when the form is submitted twice", async () => {
      // The realistic trigger is two tabs or a retried request, neither of
      // which a disabled submit button catches.
      const id = await add({ notes: "Once" });

      const first = await promote(id);
      const second = await promote(id);

      expect(second.data!.contactId).toBe(first.data!.contactId);
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(1);
      expect(await prisma.relationship.count({ where: { ownerId } })).toBe(2);
      expect(await prisma.fact.count({ where: { ownerId } })).toBe(1);
    });

    it("makes one person, not two, when two requests race", async () => {
      const id = await add({ notes: "Once" });

      const [first, second] = await Promise.all([promote(id), promote(id)]);

      expect(first.ok && second.ok).toBe(true);
      expect(first.data!.contactId).toBe(second.data!.contactId);
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(1);
      expect(await prisma.relationship.count({ where: { ownerId } })).toBe(2);
      expect(await prisma.fact.count({ where: { ownerId } })).toBe(1);
    });

    it("refuses a relationship type belonging to another account", async () => {
      const id = await add();
      const theirs = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId: strangerId, kind: "RELATIONSHIP_TYPE" },
        select: { id: true },
      });

      expect(await promote(id, { typeId: theirs.id })).toMatchObject({ ok: false });
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(0);
    });

    it("refuses one of its own terms filed under the wrong kind", async () => {
      const id = await add();
      const wrong = await prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId, kind: "FACT_CATEGORY" },
        select: { id: true },
      });

      expect(await promote(id, { typeId: wrong.id })).toMatchObject({ ok: false });
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(0);
    });

    it("does not publish a name that was behind the lock", async () => {
      const id = await add({ isPrivate: "true" });

      const result = await promote(id);
      const person = await prisma.contact.findUniqueOrThrow({
        where: { id: result.data!.contactId },
      });
      expect(person.isPrivate).toBe(true);
    });

    it("marks the new person private when the friend they are connected to is", async () => {
      const id = await add({ contactId: hiddenId, name: "Dana" });

      const result = await promote(id, { firstName: "Dana" });
      const person = await prisma.contact.findUniqueOrThrow({
        where: { id: result.data!.contactId },
      });
      expect(person.isPrivate).toBe(true);
    });

    it("cannot reach an entry known only through a private person while the lock is closed", async () => {
      const id = await add({ contactId: hiddenId, name: "Dana" });
      lock();

      expect(await promote(id, { firstName: "Dana" })).toMatchObject({ ok: false });
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Dana" } })).toBe(0);
    });

    it("withholds the whole entry once the person it became is private", async () => {
      // Not merely the link. The entry still carries the name it was written
      // under, and that name is now a private contact's — leaving the row
      // says "there is someone called Bob, and he is tracked" from a page the
      // lock does not gate.
      const id = await add();
      const result = await promote(id);
      await prisma.contact.update({
        where: { id: result.data!.contactId },
        data: { isPrivate: true },
      });

      lock();
      expect((await listAssociateGroups(ownerId)).items).toHaveLength(0);
      expect(await associatesForContact(ownerId, aliceId)).toHaveLength(0);
      // And it cannot be found by the name either.
      expect((await listContacts(ownerId, { search: "Bob" }, TZ)).items).toHaveLength(0);
    });

    it("does not publish a name because it read the privacy a moment too early", async () => {
      // The interleaving, not a sleep: the uncommitted write is invisible to
      // the read `promoteAssociate` takes before its transaction opens, so the
      // action starts out believing this person is public. Its locking read
      // then waits on the held row, and sees the truth once released.
      //
      // Without that lock the profile is created from the stale read — public,
      // carrying facts about a now-hidden person's colleague.
      const id = await add({ notes: "On night shifts." });
      const held = await holdUncommitted((tx) =>
        tx.contact.update({ where: { id: aliceId }, data: { isPrivate: true } }),
      );

      const promoting = promote(id);
      // Let the action get past its pre-transaction read and into the lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
      held.release();
      await held.settled;

      const result = await promoting;
      expect(result.ok).toBe(true);
      const person = await prisma.contact.findUniqueOrThrow({
        where: { id: result.data!.contactId },
      });
      expect(person.isPrivate).toBe(true);
    });

    it("refuses a note that arrives while the promotion holds the entry", async () => {
      // Without the shared row lock the note would land on the entry after its
      // notes had been copied, and never reach the person it became.
      const id = await add();
      const held = await holdUncommitted((tx) =>
        tx.$queryRaw`SELECT id FROM Associate WHERE id = ${id} FOR UPDATE`.then(() =>
          tx.associate.update({ where: { id }, data: { promotedContactId: aliceId } }),
        ),
      );

      const noting = createAssociateNote(form({ associateId: id, kind: "DETAIL", content: "Late" }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      held.release();
      await held.settled;

      expect(await noting).toMatchObject({ ok: false });
      expect(await prisma.associateNote.count({ where: { associateId: id } })).toBe(0);
    });

    it("survives the promoted person being deleted, and becomes editable again", async () => {
      // SET NULL rather than CASCADE: tidying up the person must not throw
      // away the notes the owner wrote about them.
      const id = await add({ notes: "On night shifts." });
      const result = await promote(id);
      await prisma.contact.delete({ where: { id: result.data!.contactId } });

      const row = await prisma.associate.findUniqueOrThrow({ where: { id }, include: { notes: true } });
      expect(row).toMatchObject({ name: "Bob", promotedContactId: null });
      expect(row.notes.map((n) => n.content)).toEqual(["On night shifts."]);
      expect(await updateAssociate(form({ id, name: "Robert" }))).toMatchObject({ ok: true });
    });

    it("drops a promotion pointer aimed at another account's person", async () => {
      // The one key here the database does not hold to a single owner, so the
      // readers close it by hand. Written the way a restore could.
      const id = await add();
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      await prisma.associate.update({
        where: { id },
        data: { promotedContactId: theirs.id },
      });

      const [group] = (await listAssociateGroups(ownerId)).items;
      expect(group.entries[0]).toMatchObject({ isPromoted: true, promoted: null });

      const [onAlice] = await associatesForContact(ownerId, aliceId);
      expect(onAlice.promoted).toBeNull();
      expect((await getAssociate(ownerId, id))?.promoted).toBeNull();
    });
  });
});
