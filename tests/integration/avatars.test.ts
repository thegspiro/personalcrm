import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: "Etc/UTC" }),
}));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: state.enabled, unlocked: state.unlocked }),
  recordProtectedReadActivity: async () => {},
}));

const { deleteContact, updateContact } = await import("@/server/actions/contacts");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function edit(id: string, avatar?: File, remove = false): FormData {
  const data = new FormData();
  data.set("id", id);
  data.set("firstName", "Robin");
  if (avatar) data.set("avatar", avatar);
  if (remove) data.set("removeAvatar", "true");
  return data;
}

describe.skipIf(!hasTestDatabase)("avatar actions", () => {
  let directory: string;
  let ownerId: string;
  let contactId: string;

  beforeEach(async () => {
    await reset();
    directory = await mkdtemp(join(tmpdir(), "personalcrm-avatar-actions-"));
    process.env.UPLOADS_DIR = directory;
    const user = await createTestUser();
    ownerId = user.id;
    state.ownerId = ownerId;
    state.enabled = false;
    state.unlocked = true;
    contactId = (await prisma.contact.create({ data: { ownerId, firstName: "Robin" } })).id;
  });

  afterAll(async () => {
    delete process.env.UPLOADS_DIR;
    await prisma.$disconnect();
  });

  it("rejects another owner's contact before writing a file", async () => {
    state.ownerId = (await createTestUser()).id;
    expect((await updateContact(edit(contactId, new File([PNG], "x.png")))).ok).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects a locked private contact before writing a file", async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { isPrivate: true } });
    state.enabled = true;
    state.unlocked = false;
    expect((await updateContact(edit(contactId, new File([PNG], "x.png")))).ok).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it("atomically replaces and removes an avatar, cleaning obsolete files", async () => {
    expect((await updateContact(edit(contactId, new File([PNG], "first.png")))).ok).toBe(true);
    const first = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(await readdir(directory)).toHaveLength(1);

    expect((await updateContact(edit(contactId, new File([Uint8Array.from([...PNG, 2])], "second.png")))).ok).toBe(true);
    const second = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(second.avatarPath).not.toBe(first.avatarPath);
    expect(await readdir(directory)).toHaveLength(1);

    expect((await updateContact(edit(contactId, undefined, true))).ok).toBe(true);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).avatarPath).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it("cleans the avatar after deleting its contact", async () => {
    await updateContact(edit(contactId, new File([PNG], "avatar.png")));
    expect((await deleteContact(contactId)).ok).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });
});
