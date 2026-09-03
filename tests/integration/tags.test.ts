import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: false,
  unlocked: true,
}));
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma,
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
  getPrivacyState: async () => ({
    enabled: state.enabled,
    unlocked: state.unlocked,
  }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { createTag, deleteTag, mergeTag, setContactTag } =
  await import("@/server/actions/tags");
const { createContact, updateContact } = await import("@/server/actions/contacts");
const { listTags } = await import("@/server/queries/tags");
const { listContacts } = await import("@/server/queries/contacts");

describe.skipIf(!hasTestDatabase)("contact tags", () => {
  beforeEach(async () => {
    await reset();
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
});
