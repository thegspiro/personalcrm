import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUE_SOON_DAYS } from "@/lib/cadence";

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock("@/server/db/client", () => ({ prisma: { contact: { findMany, count } } }));
vi.mock("@/server/privacy/filter", () => ({
  privacyScope: vi.fn().mockResolvedValue({ enabled: true, unlocked: false }),
  contactPrivacyWhere: vi.fn(() => ({ isPrivate: false })),
  factPrivacyWhere: vi.fn(() => ({})),
  interactionPrivacyWhere: vi.fn(() => ({})),
}));

import { listContacts } from "@/server/queries/contacts";

async function whereFor(dueStatus: "actionable" | "soon" | undefined) {
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  await listContacts("owner-1", { dueStatus, sort: "overdue" }, "America/New_York");
  return findMany.mock.calls[0]?.[0]?.where;
}

describe("contact due-status filter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T04:30:00.000Z")); // Mar 7, 11:30pm in New York
    findMany.mockReset();
    count.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("takes the whole of the account's current day, not the server's instant", async () => {
    // 11:30pm locally: an instant cutoff would drop someone due at 11:45pm,
    // and the server's own UTC calendar would already have rolled into Mar 8.
    expect(await whereFor("actionable")).toMatchObject({
      ownerId: "owner-1",
      isArchived: false,
      isPrivate: false,
      cadenceDays: { not: null },
      nextTouchAt: { not: null, lt: new Date("2026-03-08T05:00:00.000Z") },
    });
  });

  it("reaches the same horizon as the dashboard widget it is linked from", async () => {
    // Midnight after the final included day. Spanning the spring DST change
    // rather than adding a fixed number of milliseconds.
    expect(await whereFor("soon")).toMatchObject({
      cadenceDays: { not: null },
      nextTouchAt: { not: null, lt: new Date("2026-03-11T04:00:00.000Z") },
    });
    expect(DUE_SOON_DAYS).toBe(3);
  });

  it("leaves the query alone when no due filter is asked for", async () => {
    const where = await whereFor(undefined);
    expect(where).not.toHaveProperty("nextTouchAt");
    expect(where).not.toHaveProperty("cadenceDays");
  });

  it("counts the rows it lists, so unlocking cannot shift the total on its own", async () => {
    await whereFor("actionable");
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0][0].where });
  });
});
