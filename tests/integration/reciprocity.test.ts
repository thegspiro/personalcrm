import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", enabled: true, unlocked: false }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    expiresAt: null,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: false }) as const,
}));

const { getReciprocity } = await import("@/server/queries/contacts");

/**
 * `summarizeReciprocity` is covered as pure maths in `tests/unit`. What needs a
 * database is the query that feeds it: the contact filter and the privacy
 * filter both constrain `participants`, and combining them wrongly makes the
 * summary quietly describe the whole account instead of one person.
 */
describe.skipIf(!hasTestDatabase)("reciprocity for one contact", () => {
  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
  });

  afterAll(() => prisma.$disconnect());

  it("counts only the contact's own interactions, with the lock closed as well as open", async () => {
    const [ada, someoneElse] = await Promise.all([
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Ada" } }),
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Blaise" } }),
    ]);

    const log = (contactId: string, reachedOutBy: "ME" | "THEM") =>
      prisma.interaction.create({
        data: {
          ownerId: state.ownerId,
          occurredAt: new Date(),
          reachedOutBy,
          participants: { create: [{ contactId }] },
        },
      });

    await log(ada.id, "ME");
    // Somebody else entirely. Nothing about these belongs in Ada's summary,
    // and none of them is private, so no privacy filter would exclude them.
    await log(someoneElse.id, "THEM");
    await log(someoneElse.id, "THEM");
    await log(someoneElse.id, "THEM");

    for (const unlocked of [false, true]) {
      state.unlocked = unlocked;
      const summary = await getReciprocity(state.ownerId, ada.id, "UTC");
      expect({ unlocked, ...summary }).toMatchObject({
        unlocked,
        me: 1,
        them: 0,
        mutual: 0,
      });
    }
  });
});
