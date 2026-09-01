import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The aggregates on the settings screen.
 *
 * Settings stays reachable while the lock is closed, so a total taken there is
 * a total the lock does not gate. Unfiltered, it answers "how many private
 * people are filed under this" without ever rendering a row — which is why the
 * invariant covers counts and not only records.
 */
const state = vi.hoisted(() => ({ enabled: true, unlocked: false, userId: "" }));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.userId, role: "ADMIN" },
    timezone: "America/New_York",
    prefs: {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { listTaxonomyAdmin } = await import("@/server/queries/taxonomy-admin");
const { valueCountsByDefinition } = await import("@/server/queries/custom-fields");
const { deleteTerm } = await import("@/server/actions/taxonomy");

describe.skipIf(!hasTestDatabase)("settings counts under the lock", () => {
  let ownerId: string;
  let publicId: string;
  let privateId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    state.userId = user.id;
    state.enabled = true;
    state.unlocked = false;

    const [open, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId, firstName: "Public" } }),
      prisma.contact.create({ data: { ownerId, firstName: "Secret", isPrivate: true } }),
    ]);
    publicId = open.id;
    privateId = secret.id;
  });

  afterAll(() => prisma.$disconnect());

  async function usageFor(termId: string) {
    const groups = await listTaxonomyAdmin(ownerId);
    return groups.flatMap((group) => group.terms).find((term) => term.id === termId)?.usageCount;
  }

  it("counts a taxonomy term only where the row behind it is visible", async () => {
    const type = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "CONTACT_METHOD_TYPE", slug: "mobile" },
    });
    await prisma.contactMethod.createMany({
      data: [
        { contactId: publicId, typeId: type.id, value: "555-0100" },
        { contactId: privateId, typeId: type.id, value: "555-0111" },
      ],
    });

    expect(await usageFor(type.id)).toBe(1);

    state.unlocked = true;
    expect(await usageFor(type.id)).toBe(2);
  });

  it("does the same for facts, which carry a marker of their own", async () => {
    const category = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "FACT_CATEGORY" },
    });
    await prisma.fact.createMany({
      data: [
        { ownerId, contactId: publicId, categoryId: category.id, content: "open" },
        { ownerId, contactId: publicId, categoryId: category.id, content: "marked", isPrivate: true },
        { ownerId, contactId: privateId, categoryId: category.id, content: "hidden person" },
      ],
    });

    // Both routes to a hidden fact: the marker on the row, and the contact.
    expect(await usageFor(category.id)).toBe(1);

    state.unlocked = true;
    expect(await usageFor(category.id)).toBe(3);
  });

  it("withholds a dating taxonomy whole rather than filtering it", async () => {
    const stage = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "DATING_STAGE" },
    });
    await prisma.romanticProfile.create({
      data: { ownerId, contactId: publicId, stageId: stage.id },
    });

    // The module is hidden entirely while locked, so its counts report nothing
    // rather than a number filtered row by row.
    expect(await usageFor(stage.id)).toBe(0);

    state.unlocked = true;
    expect(await usageFor(stage.id)).toBe(1);
  });

  it("does not count a life event whose participants include a private person", async () => {
    const type = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "LIFE_EVENT_TYPE" },
    });
    // Both are filed against the public contact, so an anchor-only filter
    // admits them equally. The second names the private one as a participant,
    // which is what the timeline hides it on.
    await prisma.lifeEvent.create({
      data: {
        ownerId,
        contactId: publicId,
        typeId: type.id,
        title: "Moved house",
        date: new Date("2020-06-01"),
        participants: { create: [{ contactId: publicId }] },
      },
    });
    await prisma.lifeEvent.create({
      data: {
        ownerId,
        contactId: publicId,
        typeId: type.id,
        title: "Married",
        date: new Date("2021-06-01"),
        participants: { create: [{ contactId: publicId }, { contactId: privateId }] },
      },
    });

    expect(await usageFor(type.id)).toBe(1);

    state.unlocked = true;
    expect(await usageFor(type.id)).toBe(2);
  });

  it("refuses to delete a term without saying how many hidden rows use it", async () => {
    const category = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "FACT_CATEGORY" },
    });
    // Filed against the private contact only, so the settings tally already
    // reports zero for this term while the lock is closed.
    await prisma.fact.create({
      data: { ownerId, contactId: privateId, categoryId: category.id, content: "hidden" },
    });
    expect(await usageFor(category.id)).toBe(0);

    // The guard itself stays unfiltered — deleting would cascade the private
    // row away — but the refusal must not quote the number the lock is holding.
    const locked = await deleteTerm(category.id);
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/^Something still uses this\./);
    expect(locked.error).not.toMatch(/\d/);
    expect(await prisma.taxonomyTerm.count({ where: { id: category.id } })).toBe(1);

    state.unlocked = true;
    const unlocked = await deleteTerm(category.id);
    expect(unlocked.ok).toBe(false);
    expect(unlocked.error).toMatch(/^1 record uses this\./);
  });

  it("counts custom-field values the same way", async () => {
    const [onContacts, onProfiles] = await Promise.all([
      prisma.customFieldDefinition.create({
        data: { ownerId, entity: "CONTACT", key: "origin", label: "Origin", fieldType: "TEXT", sortOrder: 0 },
      }),
      prisma.customFieldDefinition.create({
        data: { ownerId, entity: "ROMANTIC", key: "vibe", label: "Vibe", fieldType: "TEXT", sortOrder: 0 },
      }),
    ]);
    await prisma.customFieldValue.createMany({
      data: [
        { ownerId, definitionId: onContacts.id, entityType: "CONTACT", entityId: publicId, value: "a" },
        { ownerId, definitionId: onContacts.id, entityType: "CONTACT", entityId: privateId, value: "b" },
        { ownerId, definitionId: onProfiles.id, entityType: "ROMANTIC", entityId: privateId, value: "c" },
      ],
    });

    const locked = await valueCountsByDefinition(ownerId, { enabled: true, unlocked: false });
    expect(locked.get(onContacts.id)).toBe(1);
    expect(locked.get(onProfiles.id)).toBeUndefined();

    const unlocked = await valueCountsByDefinition(ownerId, { enabled: true, unlocked: true });
    expect(unlocked.get(onContacts.id)).toBe(2);
    expect(unlocked.get(onProfiles.id)).toBe(1);
  });
});
