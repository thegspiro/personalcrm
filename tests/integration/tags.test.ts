import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: false,
  unlocked: true,
  // Fires once inside the next privacy read, then clears itself. `mergeTag`
  // and `deleteTag` consult the lock after they have established that the
  // tags exist and before they touch anything, so this is the window another
  // tab commits into — and the only place a test can stand in it.
  duringPrivacyRead: null as null | (() => Promise<void>),
  // Fires once immediately before the next write, then clears itself. Every
  // write in this module reads first, and the window a concurrent delete lands
  // in is between that read and the write — which no seam in the action's own
  // dependencies sits inside, because they are all consulted before the read.
  beforeWrite: null as null | (() => Promise<void>),
}));
const WRITES = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        const interleaved = state.beforeWrite;
        if (interleaved && WRITES.includes(operation)) {
          state.beforeWrite = null;
          await interleaved();
        }
        return query(args);
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "UTC",
  }),
}));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => {
    const interleaved = state.duringPrivacyRead;
    state.duringPrivacyRead = null;
    if (interleaved) await interleaved();
    return { enabled: state.enabled, unlocked: state.unlocked };
  },
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { createTag, deleteTag, mergeTag, renameTag, setContactTag } =
  await import("@/server/actions/tags");
const { createContact, updateContact } = await import("@/server/actions/contacts");
const { listTags } = await import("@/server/queries/tags");
const { getContact } = await import("@/server/queries/contacts");
const { listContacts } = await import("@/server/queries/contacts");

describe.skipIf(!hasTestDatabase)("contact tags", () => {
  beforeEach(async () => {
    await reset();
    state.duringPrivacyRead = null;
    state.beforeWrite = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("assigns and filters, while rejecting another owner's tag", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    state.ownerId = owner.id;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Dana" },
    });
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Friends", slug: "friends" },
    });
    const foreign = await prisma.tag.create({
      data: { ownerId: stranger.id, name: "Secret", slug: "secret" },
    });
    expect((await setContactTag(contact.id, tag.id, true)).ok).toBe(true);
    expect((await setContactTag(contact.id, foreign.id, true)).ok).toBe(false);
    expect(
      (await listContacts(owner.id, { tagId: tag.id }, "UTC")).items.map(
        (row) => row.id,
      ),
    ).toEqual([contact.id]);
    expect((await listTags(owner.id)).map((row) => row.id)).toEqual([tag.id]);

    expect((await setContactTag(contact.id, tag.id, false)).ok).toBe(true);
    expect((await listContacts(owner.id, { tagId: tag.id }, "UTC")).items).toEqual([]);
  });

  it("merges assignments without duplicates and deletion keeps contacts", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Dana" },
    });
    const [source, destination] = await Promise.all([
      prisma.tag.create({
        data: {
          ownerId: owner.id,
          name: "Pal",
          slug: "pal",
          contacts: { create: { contactId: contact.id } },
        },
      }),
      prisma.tag.create({
        data: {
          ownerId: owner.id,
          name: "Friend",
          slug: "friend",
          contacts: { create: { contactId: contact.id } },
        },
      }),
    ]);
    expect((await mergeTag(source.id, destination.id)).ok).toBe(true);
    expect(
      await prisma.contactTag.count({ where: { contactId: contact.id } }),
    ).toBe(1);
    expect((await deleteTag(destination.id)).ok).toBe(true);
    expect(await prisma.contact.count({ where: { id: contact.id } })).toBe(1);
  });

  it("does not expose private-only tag names or counts while locked", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
    const [visible, hidden] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Dana" } }),
      prisma.contact.create({
        data: { ownerId: owner.id, firstName: "Robin", isPrivate: true },
      }),
    ]);
    await prisma.tag.create({
      data: {
        ownerId: owner.id,
        name: "Visible",
        slug: "visible",
        contacts: {
          create: [{ contactId: visible.id }, { contactId: hidden.id }],
        },
      },
    });
    await prisma.tag.create({
      data: {
        ownerId: owner.id,
        name: "Hidden clue",
        slug: "hidden-clue",
        contacts: { create: { contactId: hidden.id } },
      },
    });
    expect(await listTags(owner.id)).toEqual([
      expect.objectContaining({ name: "Visible", usageCount: 1 }),
    ]);
  });
  it("keeps a tag nobody carries listed while locked, so it can be given out", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const form = new FormData();
    form.set("name", "Cycling");
    expect((await createTag(form)).ok).toBe(true);

    // A tag on nobody discloses nobody. Hiding it left one just created
    // missing from settings and from every contact form until an unlock.
    state.unlocked = false;
    expect((await listTags(owner.id)).map((tag) => tag.name)).toEqual(["Cycling"]);
  });

  it("refuses to merge or delete a tag whose other half is hidden by the lock", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const [visible, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Dana" } }),
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Robin", isPrivate: true } }),
    ]);
    const [source, destination] = await Promise.all([
      prisma.tag.create({ data: { ownerId: owner.id, name: "Climbing", slug: "climbing" } }),
      prisma.tag.create({ data: { ownerId: owner.id, name: "Outdoors", slug: "outdoors" } }),
    ]);
    await prisma.contactTag.createMany({
      data: [
        { contactId: visible.id, tagId: source.id },
        { contactId: secret.id, tagId: source.id },
      ],
    });

    // The visible half keeps the tag listed while locked, so it is offered —
    // but acting on it would move or destroy the private association too.
    state.unlocked = false;
    expect((await listTags(owner.id)).map((tag) => tag.name).sort()).toEqual(["Climbing", "Outdoors"]);
    expect((await mergeTag(source.id, destination.id)).ok).toBe(false);
    expect((await deleteTag(source.id)).ok).toBe(false);
    expect(await prisma.contactTag.count({ where: { tagId: source.id } })).toBe(2);
    expect(await prisma.tag.count({ where: { ownerId: owner.id } })).toBe(2);

    // Unlocked, both are the owner's to do.
    state.unlocked = true;
    expect((await mergeTag(source.id, destination.id)).ok).toBe(true);
    expect(await prisma.contactTag.count({ where: { tagId: destination.id } })).toBe(2);
  });

  it("will not answer whether a hidden tag name is taken, and will not rename one", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const secret = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Robin", isPrivate: true },
    });
    const hiddenTag = await prisma.tag.create({
      data: {
        ownerId: owner.id,
        name: "Therapy",
        slug: "therapy",
        contacts: { create: { contactId: secret.id } },
      },
    });

    state.unlocked = false;
    const taken = new FormData();
    taken.set("name", "Therapy");
    const free = new FormData();
    free.set("name", "Cycling");

    // Creating answers "is this name taken", and a name that is taken but
    // matches nothing you can see is a tag the lock is hiding. Identical
    // refusals, so the two cannot be told apart — the signal was the refusal,
    // not the sentence.
    const onto = await createTag(taken);
    const other = await createTag(free);
    expect(onto.ok).toBe(false);
    expect(other.ok).toBe(false);
    expect(onto.error).toBe(other.error);
    expect(onto.error).toMatch(/unlock/i);
    expect(await prisma.tag.count({ where: { ownerId: owner.id } })).toBe(1);

    // Renaming is the same question asked the other way round, and the id it
    // takes may be one Settings listed before the lock closed.
    const rename = new FormData();
    rename.set("id", hiddenTag.id);
    rename.set("name", "Wellbeing");
    const renamed = await renameTag(rename);
    expect(renamed.ok).toBe(false);
    expect(renamed.error).toMatch(/unlock/i);
    expect(
      (await prisma.tag.findUniqueOrThrow({ where: { id: hiddenTag.id } })).name,
    ).toBe("Therapy");

    // Unlocked, both are ordinary again.
    state.unlocked = true;
    expect((await createTag(free)).ok).toBe(true);
    expect((await createTag(taken)).ok).toBe(false);
    expect((await renameTag(rename)).ok).toBe(true);
  });

  it("answers for another account's tag the same way whatever is assigned to it", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;

    // Two tags belonging to someone else: one on a private contact of theirs,
    // one on nobody. Unscoped, the hidden-assignment probe ran before
    // ownership was established and answered from their rows — the unlock
    // message for the first, "Tag not found" for the second, which is itself
    // a fact about an account this one cannot see.
    const theirContact = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Nobody", isPrivate: true },
    });
    const theirUsedTag = await prisma.tag.create({
      data: {
        ownerId: stranger.id,
        name: "Theirs",
        slug: "theirs",
        contacts: { create: { contactId: theirContact.id } },
      },
    });
    const theirEmptyTag = await prisma.tag.create({
      data: { ownerId: stranger.id, name: "Spare", slug: "spare" },
    });

    const used = await deleteTag(theirUsedTag.id);
    const empty = await deleteTag(theirEmptyTag.id);
    expect(used.ok).toBe(false);
    expect(empty.ok).toBe(false);
    expect(used.error).toBe(empty.error);
    expect(used.error).toMatch(/not found/i);
    expect(await prisma.tag.count({ where: { ownerId: stranger.id } })).toBe(2);
  });

  it("does not show a contact a tag that belongs to another account", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const mine = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Dana" },
    });
    const theirs = await prisma.tag.create({
      data: { ownerId: stranger.id, name: "Their Label", slug: "their-label" },
    });
    // ContactTag.contactId and Tag.id are independent foreign keys with
    // nothing tying their owners together, so an import or a restore can join
    // one account's contact to another's tag. Unfiltered, the profile rendered
    // that name and the edit form was handed its join id — and saving replaces
    // every join, so the foreign association became this account's to destroy.
    await prisma.contactTag.create({
      data: { contactId: mine.id, tagId: theirs.id },
    });

    const detail = await getContact(owner.id, mine.id);
    expect(detail).not.toBeNull();
    expect(detail?.tags.map((join) => join.tag.name) ?? []).toEqual([]);
  });

  it("does not carry another account's person through a tag merge", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const [mine, theirs] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Dana" } }),
      prisma.contact.create({ data: { ownerId: stranger.id, firstName: "Nobody" } }),
    ]);
    const [source, destination] = await Promise.all([
      prisma.tag.create({ data: { ownerId: owner.id, name: "Climbing", slug: "climbing" } }),
      prisma.tag.create({ data: { ownerId: owner.id, name: "Outdoors", slug: "outdoors" } }),
    ]);
    // Independent foreign keys again: this account's tag joined to another
    // account's person. Copying that row onto the destination would make this
    // account the author of a cross-owner association it cannot see.
    await prisma.contactTag.createMany({
      data: [
        { contactId: mine.id, tagId: source.id },
        { contactId: theirs.id, tagId: source.id },
      ],
    });

    expect((await mergeTag(source.id, destination.id)).ok).toBe(true);

    const moved = await prisma.contactTag.findMany({
      where: { tagId: destination.id },
      select: { contactId: true },
    });
    expect(moved.map((join) => join.contactId)).toEqual([mine.id]);
  });

  it("answers a lost name race with the ordinary message, not a server error", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;

    // Both requests pass the existence check before either insert commits —
    // two tabs, or two clicks. The loser met the unique key as a thrown error
    // rather than the sentence the winner's duplicate would have produced,
    // which is the same outcome reached by a different route.
    const name = new FormData();
    name.set("name", "Climbing");
    const [first, second] = await Promise.all([createTag(name), createTag(name)]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const loser = first.ok ? second : first;
    expect(loser.error).toMatch(/already exists/i);
    expect(await prisma.tag.count({ where: { ownerId: owner.id } })).toBe(1);

    // The same race from the other direction: renaming onto a name taken in
    // between the check and the update.
    const other = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Outdoors", slug: "outdoors" },
    });
    const rename = new FormData();
    rename.set("id", other.id);
    rename.set("name", "Climbing");
    const renamed = await renameTag(rename);
    expect(renamed.ok).toBe(false);
    expect(renamed.error).toMatch(/already used/i);
  });

  it("still counts a tag as unassigned when only another account uses it", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Cycling", slug: "cycling" },
    });
    const theirs = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Nobody" },
    });
    // One imported row joining this account's tag to a person it does not own.
    // "On nobody" has to mean nobody of *this* account's, or the tag vanishes
    // while locked on the strength of someone its owner cannot see — and
    // becomes unusable in every write path with it.
    await prisma.contactTag.create({ data: { contactId: theirs.id, tagId: tag.id } });

    state.unlocked = false;
    expect((await listTags(owner.id)).map((row) => row.name)).toEqual(["Cycling"]);

    const mine = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Dana" },
    });
    expect((await setContactTag(mine.id, tag.id, true)).ok).toBe(true);
  });

  it("refuses a tag the lock is hiding on every write that takes its id", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const secret = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Robin", isPrivate: true },
    });
    const hiddenTag = await prisma.tag.create({
      data: {
        ownerId: owner.id,
        name: "Therapy",
        slug: "therapy",
        contacts: { create: { contactId: secret.id } },
      },
    });
    const visible = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Dana" },
    });

    // A contact form rendered while unlocked keeps this id. Closing the lock
    // in another tab does not empty that form, and submitting it attached a
    // tag that exists only on someone private to someone visible — which both
    // writes a private-derived association from a locked session and puts the
    // hidden tag's name back into listTags through its new visible use.
    state.unlocked = false;
    expect((await listTags(owner.id)).map((tag) => tag.name)).toEqual([]);

    const edit = new FormData();
    edit.set("id", visible.id);
    edit.set("firstName", "Dana");
    edit.append("tagIds", hiddenTag.id);
    expect((await updateContact(edit)).ok).toBe(false);

    const add = new FormData();
    add.set("firstName", "Sam");
    add.append("tagIds", hiddenTag.id);
    expect((await createContact(add)).ok).toBe(false);

    expect((await setContactTag(visible.id, hiddenTag.id, true)).ok).toBe(false);
    expect(await prisma.contactTag.count({ where: { tagId: hiddenTag.id } })).toBe(1);
    expect(await prisma.contact.count({ where: { firstName: "Sam" } })).toBe(0);

    // Unlocked it is an ordinary tag of the owner's again.
    state.unlocked = true;
    expect((await setContactTag(visible.id, hiddenTag.id, true)).ok).toBe(true);
    expect(await prisma.contactTag.count({ where: { tagId: hiddenTag.id } })).toBe(2);
  });

  it("keeps the source tag when the destination is deleted mid-merge", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Robin" },
    });
    const source = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Work", slug: "work" },
    });
    const destination = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Colleagues", slug: "colleagues" },
    });
    await prisma.contactTag.create({
      data: { contactId: contact.id, tagId: source.id },
    });
    state.duringPrivacyRead = async () => {
      await prisma.tag.delete({ where: { id: destination.id } });
    };

    expect((await mergeTag(source.id, destination.id)).ok).toBe(false);
    // The refusal is the small half. `createMany` with `skipDuplicates` is
    // `INSERT IGNORE` on MariaDB, which demotes the foreign-key violation to a
    // warning and drops the row — so the assignments went nowhere, the source
    // was deleted on top of them, and the merge reported success while the tag
    // simply came off this person.
    expect(await prisma.tag.count({ where: { id: source.id } })).toBe(1);
    expect(
      await prisma.contactTag.count({
        where: { contactId: contact.id, tagId: source.id },
      }),
    ).toBe(1);
  });

  it("answers 'not found' when the source is deleted mid-merge", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const source = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Gym", slug: "gym" },
    });
    const destination = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Sport", slug: "sport" },
    });
    state.duringPrivacyRead = async () => {
      await prisma.tag.delete({ where: { id: source.id } });
    };

    // P2025 out of the delete, which escaped the action as a server error
    // rather than the sentence a tag that is no longer there deserves.
    const result = await mergeTag(source.id, destination.id);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Tag not found.");
    expect(await prisma.tag.count({ where: { id: destination.id } })).toBe(1);
  });
  it("answers 'not found' when a tag is deleted between the check and the rename", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Book club", slug: "book-club" },
    });
    state.beforeWrite = async () => {
      await prisma.tag.delete({ where: { id: tag.id } });
    };

    const form = new FormData();
    form.set("id", tag.id);
    form.set("name", "Reading group");
    // P2025 out of the update, escaping as a server error on a tag that is
    // simply no longer there — the answer the read a moment later would give.
    const result = await renameTag(form);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Tag not found.");
  });

  it("answers 'not found' when the tag is deleted before the assignment", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Sam" },
    });
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Neighbours", slug: "neighbours" },
    });
    // Before the transaction, because the lock the assignment now takes closes
    // the window after it: a delete cannot commit while the row is held, so the
    // lock simply comes back empty and there is no foreign key left to meet.
    state.duringPrivacyRead = async () => {
      await prisma.tag.delete({ where: { id: tag.id } });
    };

    const result = await setContactTag(contact.id, tag.id, true);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Contact or tag not found.");
  });
});

/**
 * Hold a write open and uncommitted until the returned release is called.
 *
 * The interleavings below are not sleep-timed races. An uncommitted write is
 * invisible to a plain read but its row locks are real, so it puts the action
 * under test in exactly the state a concurrent tab would: the read it takes
 * before the transaction sees nothing, and the moment it wants a lock on the
 * same row it waits. Releasing then decides the order deterministically.
 */
async function holdUncommitted(
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<{ release: () => void; settled: Promise<unknown> }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let written!: () => void;
  const ready = new Promise<void>((resolve) => {
    written = resolve;
  });
  const settled = prisma.$transaction(
    async (tx) => {
      await write(tx);
      written();
      await held;
    },
    { timeout: 20_000 },
  );
  await ready;
  return { release, settled };
}

/** Let the action reach the lock it is about to wait on, then let go. */
async function releaseAfterItBlocks(release: () => void): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  release();
}

describe.skipIf(!hasTestDatabase)("tag name validation", () => {
  beforeEach(async () => {
    await reset();
    state.duringPrivacyRead = null;
    state.beforeWrite = null;
    state.enabled = false;
    state.unlocked = true;
    state.ownerId = (await createTestUser()).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // `tagName` is a bare string schema, so its issues carry an empty path and
  // `invalid()` — which keeps only issues that have one — dropped them. The
  // toast said to check the highlighted fields, nothing was highlighted, and
  // nothing said what was wrong. `useAction` shows the field detail when there
  // is any, so naming the field is what puts the sentence on screen.
  const named = (result: Awaited<ReturnType<typeof createTag>>) =>
    result.ok === false ? result.fieldErrors?.name : undefined;

  it("names the field when a tag name is only whitespace", async () => {
    // `required` on the input is satisfied by a space, so this is reachable
    // from the form and not only from a direct request.
    const form = new FormData();
    form.set("name", "   ");
    expect(named(await createTag(form))).toBe("A tag name is required.");
  });

  it("names the field when a rename exceeds the column", async () => {
    const tag = await prisma.tag.create({
      data: { ownerId: state.ownerId, name: "Book club", slug: "book-club" },
    });
    const form = new FormData();
    form.set("id", tag.id);
    form.set("name", "x".repeat(97));
    expect(named(await renameTag(form))).toBeTruthy();
    // And the tag is untouched.
    expect(
      (await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).name,
    ).toBe("Book club");
  });
});

describe.skipIf(!hasTestDatabase)("tag writes against a concurrent tab", () => {
  beforeEach(async () => {
    await reset();
    state.duringPrivacyRead = null;
    state.beforeWrite = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses a locked merge for a private assignment made after it started", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
    const hidden = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Wren", isPrivate: true },
    });
    const source = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Choir", slug: "choir" },
    });
    const destination = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Music", slug: "music" },
    });

    // An unlocked tab puts the source tag on someone private, in the window
    // between this session's privacy question and its transaction.
    let held: Awaited<ReturnType<typeof holdUncommitted>>;
    state.duringPrivacyRead = async () => {
      held = await holdUncommitted((tx) =>
        tx.contactTag.create({
          data: { contactId: hidden.id, tagId: source.id },
        }),
      );
    };

    const merging = mergeTag(source.id, destination.id);
    await releaseAfterItBlocks(() => held.release());
    await held!.settled;
    const result = await merging;

    // Asked before the transaction, the question was about a moment that had
    // already passed: the count saw nothing, the merge went ahead, and the
    // cascade took the private assignment with the source tag — a locked
    // session destroying a record it cannot see.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Unlock to merge/);
    expect(await prisma.tag.count({ where: { id: source.id } })).toBe(1);
    expect(
      await prisma.contactTag.count({
        where: { contactId: hidden.id, tagId: source.id },
      }),
    ).toBe(1);
  });

  it("refuses a locked delete for a private assignment made after it started", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
    const hidden = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Wren", isPrivate: true },
    });
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Choir", slug: "choir" },
    });

    let held: Awaited<ReturnType<typeof holdUncommitted>>;
    state.duringPrivacyRead = async () => {
      held = await holdUncommitted((tx) =>
        tx.contactTag.create({ data: { contactId: hidden.id, tagId: tag.id } }),
      );
    };

    const deleting = deleteTag(tag.id);
    await releaseAfterItBlocks(() => held.release());
    await held!.settled;
    const result = await deleting;

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Unlock to delete/);
    expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(1);
  });

  it("refuses to assign a tag that became private-only after the check", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
    const visible = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Sam" },
    });
    const hidden = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Wren", isPrivate: true },
    });
    // On nobody, so a locked session may use it: a tag on nobody discloses
    // nothing about anybody.
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Choir", slug: "choir" },
    });

    // An unlocked tab puts it on someone private while this request is between
    // its visibility check and its write.
    let held: Awaited<ReturnType<typeof holdUncommitted>>;
    state.duringPrivacyRead = async () => {
      held = await holdUncommitted((tx) =>
        tx.contactTag.create({ data: { contactId: hidden.id, tagId: tag.id } }),
      );
    };

    const assigning = setContactTag(visible.id, tag.id, true);
    await releaseAfterItBlocks(() => held.release());
    await held!.settled;
    const result = await assigning;

    // The tag now exists only on a private person, so putting it on a visible
    // one publishes its name through that use — the disclosure the visibility
    // check exists to prevent, made by a session that cannot see the person it
    // is about. Two shared locks on the tag row do not collide, so nothing
    // else would have stopped the write either.
    expect(result.ok).toBe(false);
    expect(
      await prisma.contactTag.count({
        where: { contactId: visible.id, tagId: tag.id },
      }),
    ).toBe(0);
  });

  it("answers 'not found' when the contact is deleted mid-assignment", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Sam" },
    });
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Neighbours", slug: "neighbours" },
    });

    // Both halves are held, and the contact is why that matters rather than a
    // catch: how a vanished contact arrives at the insert depends on the
    // server — P2003 on MariaDB 10.11, but 1020 "record has changed since last
    // read" on MariaDB 11, which is no Prisma code at all and escaped as a
    // 500. CI runs 11 and found it; this machine runs 10.11 and could not.
    let held: Awaited<ReturnType<typeof holdUncommitted>>;
    state.duringPrivacyRead = async () => {
      held = await holdUncommitted((tx) =>
        tx.contact.delete({ where: { id: contact.id } }),
      );
    };

    const assigning = setContactTag(contact.id, tag.id, true);
    await releaseAfterItBlocks(() => held.release());
    await held!.settled;
    const result = await assigning;

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Contact or tag not found.");
  });

  it("reports an unavailable tag rather than failing the whole contact save", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = false;
    state.unlocked = true;
    const tag = await prisma.tag.create({
      data: { ownerId: owner.id, name: "Cycling", slug: "cycling" },
    });

    // Another tab deletes the tag while the save is in flight.
    let held: Awaited<ReturnType<typeof holdUncommitted>>;
    state.duringPrivacyRead = async () => {
      held = await holdUncommitted((tx) =>
        tx.tag.delete({ where: { id: tag.id } }),
      );
    };

    const form = new FormData();
    form.set("firstName", "Ash");
    form.append("tagIds", tag.id);
    const saving = createContact(form);
    await releaseAfterItBlocks(() => held.release());
    await held!.settled;

    // Counting alone left the insert to meet the foreign key as a P2003, which
    // nothing translates: an ordinary tag deletion elsewhere turned the whole
    // contact save into a server error.
    const result = await saving;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "One or more tags are unavailable.",
    );
  });
});
