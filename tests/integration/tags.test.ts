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

const { deleteTag, mergeTag, setContactTag } =
  await import("@/server/actions/tags");
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
      (await listContacts(owner.id, { tagId: tag.id })).items.map(
        (row) => row.id,
      ),
    ).toEqual([contact.id]);
    expect((await listTags(owner.id)).map((row) => row.id)).toEqual([tag.id]);

    expect((await setContactTag(contact.id, tag.id, false)).ok).toBe(true);
    expect((await listContacts(owner.id, { tagId: tag.id })).items).toEqual([]);
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
});
