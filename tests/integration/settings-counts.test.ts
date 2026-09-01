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
const state = vi.hoisted(() => ({ enabled: true, unlocked: false }));

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

const { listTaxonomyAdmin } = await import("@/server/queries/taxonomy-admin");
const { valueCountsByDefinition } = await import("@/server/queries/custom-fields");

describe.skipIf(!hasTestDatabase)("settings counts under the lock", () => {
  let ownerId: string;
  let publicId: string;
  let privateId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
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
