import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: false, unlocked: true }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { listContacts } = await import("@/server/queries/contacts");

describe.skipIf(!hasTestDatabase)("contact due-status filter", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    ownerId = (await createTestUser()).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("includes contacts due on the account's current day and excludes later and no-cadence contacts", async () => {
    // At 00:30 UTC these are yesterday, today, and tomorrow in Honolulu. This
    // catches both an exact-now cutoff and use of the server's UTC calendar.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:30:00Z"));
    try {
      await prisma.contact.createMany({
        data: [
          {
            ownerId,
            firstName: "Due today",
            cadenceDays: 7,
            nextTouchAt: new Date("2026-09-02T08:00:00Z"),
          },
          {
            ownerId,
            firstName: "Due later",
            cadenceDays: 7,
            nextTouchAt: new Date("2026-09-02T11:00:00Z"),
          },
          {
            ownerId,
            firstName: "No cadence",
            cadenceDays: null,
            nextTouchAt: null,
          },
        ],
      });

      const result = await listContacts(ownerId, {
        dueStatus: "actionable",
        timezone: "Pacific/Honolulu",
        sort: "overdue",
      });

      expect(result.items.map((contact) => contact.firstName)).toEqual([
        "Due today",
      ]);
      expect(result.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
