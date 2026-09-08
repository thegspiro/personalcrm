import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ enabled: false, unlocked: true }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/privacy/filter", async () => {
  const actual = await vi.importActual<typeof import("@/server/privacy/where")>(
    "@/server/privacy/where",
  );
  return {
    ...actual,
    privacyScope: async () => ({ enabled: state.enabled, unlocked: state.unlocked }),
  };
});

const { scanForDuplicates } = await import("@/server/queries/duplicates");

/**
 * Finding people who might be the same person.
 *
 * The scan is deliberately narrow, so most of what matters here is what it does
 * *not* suggest: never a name match, never across accounts, never a private
 * contact while the lock is closed — which would name them on a screen the lock
 * is meant to keep them off.
 */
describe.skipIf(!hasTestDatabase)("scanning for duplicates", () => {
  let ownerId: string;
  let emailTypeId: string;

  async function person(firstName: string, methods: string[] = [], over = {}) {
    return prisma.contact.create({
      data: {
        ownerId,
        firstName,
        ...over,
        methods: {
          create: methods.map((value) => ({ value, typeId: emailTypeId })),
        },
      },
    });
  }

  beforeEach(async () => {
    await reset();
    state.enabled = false;
    state.unlocked = true;
    ownerId = (await createTestUser()).id;
    const email = await prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "CONTACT_METHOD_TYPE", slug: "email" },
    });
    emailTypeId = email.id;
  });
  afterAll(() => prisma.$disconnect());

  it("suggests two people sharing an address", async () => {
    await person("Sam", ["sam@example.com"]);
    await person("Samuel", ["SAM@example.com"]);

    const scan = await scanForDuplicates(ownerId);
    expect(scan.suggestions).toHaveLength(1);
    expect(scan.suggestions[0]!.matches[0]!.kind).toBe("email");
  });

  it("never suggests two people who merely share a name", async () => {
    await person("Sarah Jones", ["a@example.com"]);
    await person("Sarah Jones", ["b@example.com"]);
    expect((await scanForDuplicates(ownerId)).suggestions).toEqual([]);
  });

  it("never reaches into another account", async () => {
    await person("Sam", ["sam@example.com"]);
    const other = await createTestUser();
    await prisma.contact.create({
      data: {
        ownerId: other.id,
        firstName: "Sam",
        methods: { create: [{ value: "sam@example.com" }] },
      },
    });
    expect((await scanForDuplicates(ownerId)).suggestions).toEqual([]);
  });

  it("never names a private contact while the lock is closed", async () => {
    // The suggestion would put a hidden person's name on a screen the lock
    // exists to keep them off — invariant 3, in a place easy to miss.
    await person("Sam", ["sam@example.com"]);
    await person("Hidden", ["sam@example.com"], { isPrivate: true });

    state.enabled = true;
    state.unlocked = false;
    expect((await scanForDuplicates(ownerId)).suggestions).toEqual([]);

    state.unlocked = true;
    expect((await scanForDuplicates(ownerId)).suggestions).toHaveLength(1);
  });

  it("stops suggesting a pair that has been dismissed", async () => {
    const a = await person("Partner", ["home@example.com"]);
    const b = await person("Spouse", ["home@example.com"]);
    expect((await scanForDuplicates(ownerId)).suggestions).toHaveLength(1);

    const ordered = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await prisma.duplicateDismissal.create({
      data: { ownerId, aContactId: ordered[0]!, bContactId: ordered[1]! },
    });

    expect((await scanForDuplicates(ownerId)).suggestions).toEqual([]);
  });

  it("keeps offering the other pairs in a household on one address", async () => {
    // Dismissing one pair says nothing about the others: they are different
    // judgements about different people.
    const people = [];
    for (const name of ["A", "B", "C"]) people.push(await person(name, ["home@example.com"]));
    expect((await scanForDuplicates(ownerId)).suggestions).toHaveLength(3);

    const [a, b] = people;
    const ordered = a!.id < b!.id ? [a!.id, b!.id] : [b!.id, a!.id];
    await prisma.duplicateDismissal.create({
      data: { ownerId, aContactId: ordered[0]!, bContactId: ordered[1]! },
    });

    expect((await scanForDuplicates(ownerId)).suggestions).toHaveLength(2);
  });
});
