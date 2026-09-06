import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The household write paths, driven as the forms drive them.
 *
 * `Household.name` is a `VarChar(191)` and `HouseholdMember.role` a
 * `VarChar(96)`. Nothing bounded either, so an over-long paste reached Prisma
 * and came back as a database rejection thrown out of the action rather than a
 * message the form could show. These assert the bound is the action's, not the
 * column's — a server action is a public POST, so the form's `maxLength` is a
 * convenience rather than the thing relied on.
 */
const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: "UTC" }),
}));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: state.enabled, unlocked: state.unlocked }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { addHouseholdMember, createHousehold, updateHousehold } = await import(
  "@/server/actions/family"
);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Creates one and hands back its id, failing the test rather than the types. */
async function makeHousehold(fields: Record<string, string>): Promise<string> {
  const result = await createHousehold(form(fields));
  expect(result.ok).toBe(true);
  const id = result.ok ? result.data?.id : undefined;
  if (!id) throw new Error("createHousehold returned no id");
  return id;
}

describe.skipIf(!hasTestDatabase)("household actions", () => {
  beforeEach(async () => {
    await reset();
    state.ownerId = (await createTestUser()).id;
    state.enabled = false;
    state.unlocked = true;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses a name past the column width instead of letting the database throw", async () => {
    const result = await createHousehold(form({ name: "x".repeat(192) }));

    expect(result.ok).toBe(false);
    expect(await prisma.household.count()).toBe(0);
  });

  it("accepts a name of exactly the column width", async () => {
    const result = await createHousehold(form({ name: "x".repeat(191) }));

    expect(result.ok).toBe(true);
    expect(await prisma.household.count()).toBe(1);
  });

  it("bounds a rename the same way, and leaves the old name in place", async () => {
    const id = await makeHousehold({ name: "The Whitfields" });

    const result = await updateHousehold(form({ id, name: "y".repeat(192) }));

    expect(result.ok).toBe(false);
    const row = await prisma.household.findFirstOrThrow({ where: { id } });
    expect(row.name).toBe("The Whitfields");
  });

  it("renames and re-notes a household without disturbing its members", async () => {
    const member = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Nell" },
    });
    const id = await makeHousehold({ name: "The Whitfields", memberIds: member.id });

    const result = await updateHousehold(form({ id, name: "The Whitfields upstairs", notes: "Sunday lunches." }));

    expect(result.ok).toBe(true);
    const row = await prisma.household.findFirstOrThrow({
      where: { id },
      include: { members: true },
    });
    expect(row.name).toBe("The Whitfields upstairs");
    expect(row.notes).toBe("Sunday lunches.");
    expect(row.members.map((m) => m.contactId)).toEqual([member.id]);
  });

  it("refuses a member role past its own, narrower column width", async () => {
    const id = await makeHousehold({ name: "Home" });
    const contact = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Bo" },
    });

    const result = await addHouseholdMember(
      form({ householdId: id, contactId: contact.id, role: "r".repeat(97) }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.householdMember.count({ where: { householdId: id } })).toBe(0);
  });

  it("still refuses to rename a household the closed lock is hiding", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const id = await makeHousehold({ name: "Theirs", memberIds: secret.id });

    state.enabled = true;
    state.unlocked = false;
    const result = await updateHousehold(form({ id, name: "Renamed while locked" }));

    expect(result.ok).toBe(false);
    const row = await prisma.household.findFirstOrThrow({ where: { id } });
    expect(row.name).toBe("Theirs");
  });
});
