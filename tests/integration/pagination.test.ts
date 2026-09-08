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
    canSeeDating: async () => state.unlocked,
  };
});

const { listContacts } = await import("@/server/queries/contacts");

/**
 * Paging a list, against real rows.
 *
 * The assertions that matter are not "page two shows rows 51-100" — that is
 * arithmetic, and `tests/unit/pagination.test.ts` covers it. They are that the
 * *total* driving the pager comes from the same where-clause as the rows.
 *
 * Note which direction that cuts. The count is *supposed* to change when the
 * lock opens: closed it must exclude private people, open it must include
 * them, and both readings are correct for who is looking. The disclosure
 * invariant 3 warns about is the opposite one — a pager that counts all ten
 * while showing six, so the closed screen quietly announces that four people
 * are hidden. That is what "247 people" above a filtered list of 6 would be,
 * and it is what these check against.
 */
describe.skipIf(!hasTestDatabase)("paging the people list", () => {
  const TZ = "America/New_York";
  let ownerId: string;

  async function people(count: number, over: Record<string, unknown> = {}) {
    for (let i = 0; i < count; i += 1) {
      await prisma.contact.create({
        data: {
          ownerId,
          // Zero-padded so name order is the insertion order, which is what
          // makes "page two follows page one" checkable at all.
          firstName: `Person${String(i).padStart(3, "0")}`,
          ...over,
        },
      });
    }
  }

  function page(skip: number, take: number) {
    return listContacts(ownerId, { sort: "name", skip, take }, TZ);
  }

  beforeEach(async () => {
    await reset();
    state.enabled = false;
    state.unlocked = true;
    ownerId = (await createTestUser()).id;
  });
  afterAll(() => prisma.$disconnect());

  it("walks the list without repeating or skipping anybody", async () => {
    await people(25);

    const first = await page(0, 10);
    const second = await page(10, 10);
    const third = await page(20, 10);

    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(third.items).toHaveLength(5);

    const seen = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(new Set(seen).size).toBe(25);
    expect(first.total).toBe(25);
  });

  it("returns nothing past the end rather than failing", async () => {
    await people(5);
    const beyond = await page(500, 10);
    expect(beyond.items).toEqual([]);
    // The total still tells the page which page does exist, which is what the
    // redirect back into the list is built on.
    expect(beyond.total).toBe(5);
  });

  it("counts the same rows it lists while the lock is closed", async () => {
    await people(6);
    await people(4, { isPrivate: true });

    state.enabled = true;
    state.unlocked = false;
    const locked = await page(0, 100);
    expect(locked.items).toHaveLength(6);
    expect(locked.total).toBe(6);

    state.unlocked = true;
    const unlocked = await page(0, 100);
    expect(unlocked.items).toHaveLength(10);
    expect(unlocked.total).toBe(10);
  });

  it("never counts another account's people into your page count", async () => {
    await people(3);
    const other = await createTestUser();
    await prisma.contact.create({ data: { ownerId: other.id, firstName: "Elsewhere" } });

    const mine = await page(0, 100);
    expect(mine.total).toBe(3);
    expect(mine.items.map((c) => c.firstName)).not.toContain("Elsewhere");
  });

  it("counts what a filter leaves, not the whole list", async () => {
    // The count has to come from the same where-clause as the rows, or the
    // pager offers pages a filtered list does not have.
    await people(8);
    await people(2, { firstName: "Distinct" });

    const filtered = await listContacts(ownerId, { sort: "name", search: "Distinct" }, TZ);
    expect(filtered.total).toBe(2);
    expect(filtered.items).toHaveLength(2);
  });
});
