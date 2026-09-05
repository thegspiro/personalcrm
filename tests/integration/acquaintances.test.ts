import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The people in someone's life who are not tracked themselves.
 *
 * Run through the real actions rather than an imitation, because the parts
 * worth guarding are the parts an imitation leaves out: that an entry is
 * withheld both for its own marker and for the person it hangs off, that a
 * name behind the lock cannot be found by searching for it, that promoting one
 * twice produces one person rather than two, and that deleting the person it
 * became leaves the note the owner wrote.
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
  createAcquaintance,
  deleteAcquaintance,
  promoteAcquaintance,
  updateAcquaintance,
} = await import("@/server/actions/details");
const { listAcquaintanceGroups } = await import("@/server/queries/acquaintances");
const { listContacts, getContact } = await import("@/server/queries/contacts");
const { countPrivateRows } = await import("@/server/privacy/counts");

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

    const alice = await prisma.contact.create({
      data: { ownerId, firstName: "Alice", lastName: "Chen" },
    });
    aliceId = alice.id;
    const hidden = await prisma.contact.create({
      data: { ownerId, firstName: "Hidden", isPrivate: true },
    });
    hiddenId = hidden.id;

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

  async function add(over: Record<string, string | undefined> = {}) {
    const result = await createAcquaintance(
      form({ contactId: aliceId, name: "Bob", howTheyKnow: "Colleague", ...over }),
    );
    if (!result.ok || !result.data) throw new Error(result.error ?? "create failed");
    return result.data.id;
  }

  describe("writing one down", () => {
    it("keeps the name, the connection and the note", async () => {
      const id = await add({ notes: "On night shifts until March." });

      const row = await prisma.acquaintance.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        name: "Bob",
        howTheyKnow: "Colleague",
        notes: "On night shifts until March.",
        contactId: aliceId,
        promotedContactId: null,
      });
    });

    it("refuses a nameless entry", async () => {
      expect(await createAcquaintance(form({ contactId: aliceId, name: "" }))).toMatchObject({
        ok: false,
      });
    });

    it("refuses another account's contact", async () => {
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });

      expect(
        await createAcquaintance(form({ contactId: theirs.id, name: "Bob" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.acquaintance.count()).toBe(0);
    });

    it("refuses a private contact while the lock is closed", async () => {
      // An id remembered from an unlocked session is not a way to go on
      // writing to someone the lock is currently hiding.
      lock();
      expect(
        await createAcquaintance(form({ contactId: hiddenId, name: "Bob" })),
      ).toMatchObject({ ok: false });
      expect(await prisma.acquaintance.count()).toBe(0);
    });
  });

  describe("correcting one", () => {
    it("clears a connection the form no longer names rather than keeping it", async () => {
      // The shared-fields trap: a field present only in the add form is a
      // field an edit silently leaves behind, because the action writes what
      // it finds in the whole form.
      const id = await add();

      expect(await updateAcquaintance(form({ id, name: "Bob" }))).toMatchObject({ ok: true });
      expect(
        (await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).howTheyKnow,
      ).toBeNull();
    });

    it("refuses someone else's row rather than reporting a save that never happened", async () => {
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      const entry = await prisma.acquaintance.create({
        data: { ownerId: strangerId, contactId: theirs.id, name: "Not yours" },
      });

      expect(await updateAcquaintance(form({ id: entry.id, name: "Mine now" }))).toMatchObject({
        ok: false,
      });
      expect(
        (await prisma.acquaintance.findUniqueOrThrow({ where: { id: entry.id } })).name,
      ).toBe("Not yours");
    });

    it("is out of reach while the lock is closed, not merely hidden", async () => {
      const id = await add({ isPrivate: "true" });
      lock();

      expect(await updateAcquaintance(form({ id, name: "Robert" }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).name).toBe("Bob");
    });

    it("will not hide a visible row while the lock is closed", async () => {
      // Marking one private while locked would make it vanish with no way back
      // to it without the PIN.
      const id = await add();
      lock();

      expect(
        await updateAcquaintance(form({ id, name: "Bob", isPrivate: "true" })),
      ).toMatchObject({ ok: false });
      expect((await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).isPrivate).toBe(
        false,
      );
    });

    it("edits a visible row while locked as long as the marker does not move", async () => {
      const id = await add();
      lock();

      expect(await updateAcquaintance(form({ id, name: "Robert" }))).toMatchObject({ ok: true });
      expect((await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).name).toBe(
        "Robert",
      );
    });
  });

  describe("the privacy lock", () => {
    it("withholds an entry marked private on an ordinary person", async () => {
      await add({ isPrivate: "true" });
      await add({ name: "Priya" });

      expect((await listAcquaintanceGroups(ownerId)).items[0]?.entries).toHaveLength(2);
      lock();
      const locked = await listAcquaintanceGroups(ownerId);
      expect(locked.items.flatMap((group) => group.entries).map((entry) => entry.name)).toEqual(
        ["Priya"],
      );
    });

    it("withholds an unmarked entry belonging to a private person", async () => {
      await prisma.acquaintance.create({
        data: { ownerId, contactId: hiddenId, name: "Dana" },
      });

      expect((await listAcquaintanceGroups(ownerId)).items).toHaveLength(1);
      lock();
      expect((await listAcquaintanceGroups(ownerId)).items).toHaveLength(0);
    });

    it("keeps an ordinary entry on an ordinary person in both states", async () => {
      // The control. An empty fragment must widen nothing rather than match
      // nothing — the inversion that once emptied a whole list for exactly the
      // accounts entitled to see all of it.
      await add();

      expect((await listAcquaintanceGroups(ownerId)).items).toHaveLength(1);
      lock();
      expect((await listAcquaintanceGroups(ownerId)).items).toHaveLength(1);
    });

    it("never serialises a private entry into the person's page payload", async () => {
      // detailInclude fetches the whole row, so a where-fragment elsewhere
      // does not help: without the scrub the entry reaches the browser even
      // though the section never renders it.
      await add({ isPrivate: "true" });
      lock();

      const contact = await getContact(ownerId, aliceId);
      expect(contact?.acquaintances).toHaveLength(0);
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

  describe("promoting one into a person", () => {
    async function promote(id: string, over: Record<string, string | undefined> = {}) {
      return promoteAcquaintance(
        form({ id, firstName: "Bob", lastName: "Ellis", typeId: friendTypeId, ...over }),
      );
    }

    it("creates the person, carries the note across and links them both ways", async () => {
      const id = await add({ notes: "On night shifts." });

      const result = await promote(id);
      expect(result.ok).toBe(true);
      const personId = result.data!.contactId;

      const person = await prisma.contact.findUniqueOrThrow({ where: { id: personId } });
      expect(person).toMatchObject({
        firstName: "Bob",
        lastName: "Ellis",
        summary: "On night shifts.",
        isPrivate: false,
      });

      const pair = await prisma.relationship.findMany({ where: { ownerId } });
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((row) => row.pairId)).size).toBe(1);
      expect(
        pair.map((row) => `${row.fromContactId}->${row.toContactId}`).sort(),
      ).toEqual([`${aliceId}->${personId}`, `${personId}->${aliceId}`].sort());

      expect(
        (await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).promotedContactId,
      ).toBe(personId);
    });

    it("stops being editable in place once promoted", async () => {
      const id = await add();
      await promote(id);

      expect(await updateAcquaintance(form({ id, name: "Robert" }))).toMatchObject({
        ok: false,
      });
      expect((await prisma.acquaintance.findUniqueOrThrow({ where: { id } })).name).toBe("Bob");
    });

    it("makes one person, not two, when the form is submitted twice", async () => {
      // The realistic trigger is two tabs or a retried request, neither of
      // which a disabled submit button catches.
      const id = await add();

      const first = await promote(id);
      const second = await promote(id);

      expect(second.data!.contactId).toBe(first.data!.contactId);
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(1);
      expect(await prisma.relationship.count({ where: { ownerId } })).toBe(2);
    });

    it("makes one person, not two, when two requests race", async () => {
      const id = await add();

      const [first, second] = await Promise.all([promote(id), promote(id)]);

      expect(first.ok && second.ok).toBe(true);
      expect(first.data!.contactId).toBe(second.data!.contactId);
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Bob" } })).toBe(1);
      expect(await prisma.relationship.count({ where: { ownerId } })).toBe(2);
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

    it("marks the new person private when the person they belong to is", async () => {
      const entry = await prisma.acquaintance.create({
        data: { ownerId, contactId: hiddenId, name: "Dana" },
      });

      const result = await promote(entry.id, { firstName: "Dana" });
      const person = await prisma.contact.findUniqueOrThrow({
        where: { id: result.data!.contactId },
      });
      expect(person.isPrivate).toBe(true);
    });

    it("cannot reach an entry on a private person while the lock is closed", async () => {
      const entry = await prisma.acquaintance.create({
        data: { ownerId, contactId: hiddenId, name: "Dana" },
      });
      lock();

      expect(await promote(entry.id, { firstName: "Dana" })).toMatchObject({ ok: false });
      expect(await prisma.contact.count({ where: { ownerId, firstName: "Dana" } })).toBe(0);
    });

    it("survives the promoted person being deleted, and becomes editable again", async () => {
      // SET NULL rather than CASCADE: tidying up the person must not throw
      // away the note the owner wrote about them.
      const id = await add({ notes: "On night shifts." });
      const result = await promote(id);
      await prisma.contact.delete({ where: { id: result.data!.contactId } });

      const row = await prisma.acquaintance.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: "Bob", notes: "On night shifts.", promotedContactId: null });
      expect(await updateAcquaintance(form({ id, name: "Robert" }))).toMatchObject({ ok: true });
    });

    it("drops a promotion pointer aimed at another account's person", async () => {
      // The one key here the database does not hold to a single owner, so the
      // readers close it by hand. Written the way a restore could.
      const id = await add();
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      await prisma.acquaintance.update({
        where: { id },
        data: { promotedContactId: theirs.id },
      });

      const [group] = (await listAcquaintanceGroups(ownerId)).items;
      expect(group.entries[0]).toMatchObject({ isPromoted: true, promoted: null });

      const contact = await getContact(ownerId, aliceId);
      expect(contact?.acquaintances[0]?.promoted).toBeNull();
    });
  });

  describe("removing one", () => {
    it("deletes it", async () => {
      const id = await add();
      expect(await deleteAcquaintance(id)).toMatchObject({ ok: true });
      expect(await prisma.acquaintance.count()).toBe(0);
    });

    it("goes when the person it belongs to goes", async () => {
      await add();
      await prisma.contact.delete({ where: { id: aliceId } });
      expect(await prisma.acquaintance.count()).toBe(0);
    });

    it("refuses another account's row", async () => {
      const theirs = await prisma.contact.create({
        data: { ownerId: strangerId, firstName: "Nobody" },
      });
      const entry = await prisma.acquaintance.create({
        data: { ownerId: strangerId, contactId: theirs.id, name: "Not yours" },
      });

      expect(await deleteAcquaintance(entry.id)).toMatchObject({ ok: false });
      expect(await prisma.acquaintance.count({ where: { id: entry.id } })).toBe(1);
    });
  });
});
