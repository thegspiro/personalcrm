import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const TZ = "America/New_York";
const NOW = new Date("2026-06-15T16:00:00Z"); // noon locally

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: false, unlocked: true }),
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
}));

const { getOverdueContacts, getStats } = await import("@/server/queries/dashboard");
const { listContacts } = await import("@/server/queries/contacts");

describe.skipIf(!hasTestDatabase)("cadence query day boundary", () => {
  let ownerId: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await reset();
    ownerId = (await createTestUser()).id;
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps the dashboard list, count, and overdue people query aligned through local day end", async () => {
    const dueLaterToday = await prisma.contact.create({
      data: {
        ownerId,
        firstName: "Due later today",
        cadenceDays: 30,
        nextTouchAt: new Date("2026-06-16T02:00:00Z"), // 10pm June 15 in New York
      },
    });
    const dueTomorrow = await prisma.contact.create({
      data: {
        ownerId,
        firstName: "Due tomorrow",
        cadenceDays: 30,
        nextTouchAt: new Date("2026-06-16T16:00:00Z"),
      },
    });

    const [dashboard, stats, people] = await Promise.all([
      getOverdueContacts(ownerId, TZ),
      getStats(ownerId, TZ),
      listContacts(ownerId, { dueStatus: "actionable", sort: "overdue" }, TZ),
    ]);

    // The widget deliberately reaches past today into the due-soon window, so
    // tomorrow belongs there — but it must place today's contact first and
    // count the day boundary the same way the other two queries do.
    expect(dashboard.map((contact) => contact.id)).toEqual([dueLaterToday.id, dueTomorrow.id]);
    expect(dashboard[0]?.daysUntilDue).toBe(0);
    expect(dashboard[1]?.daysUntilDue).toBe(1);

    // "Overdue" means due on or before the end of today, locally: the stat and
    // the people list agree, and neither picks up tomorrow.
    expect(stats.overdue).toBe(1);
    expect(people.items.map((contact) => contact.id)).toEqual([dueLaterToday.id]);
    expect(people.total).toBe(1);
  });
});
