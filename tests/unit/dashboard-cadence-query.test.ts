import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUE_SOON_DAYS } from "@/lib/cadence";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/server/db/client", () => ({ prisma: { contact: { findMany } } }));
vi.mock("@/server/privacy/filter", () => ({
  privacyScope: vi.fn().mockResolvedValue({ enabled: true, unlocked: false }),
  contactPrivacyWhere: vi.fn(() => ({ isPrivate: false })),
  interactionPrivacyWhere: vi.fn(() => ({})),
  viaContactPrivacyWhere: vi.fn(() => ({})),
}));

import { getOverdueContacts } from "@/server/queries/dashboard";

describe("dashboard cadence query", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T04:30:00.000Z")); // Mar 7, 11:30pm in New York
    findMany.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("owner-scopes the due-soon window and filters archived and locked-private contacts", async () => {
    findMany.mockResolvedValue([]);
    await getOverdueContacts("owner-1", "America/New_York", 6);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "owner-1",
          isArchived: false,
          isPrivate: false,
          nextTouchAt: {
            not: null,
            // Midnight after the final included day. This spans the spring DST
            // change rather than assuming every local day has 24 hours.
            lt: new Date("2026-03-11T04:00:00.000Z"),
          },
        }),
        orderBy: { nextTouchAt: "asc" },
        take: 6,
      }),
    );
    expect(DUE_SOON_DAYS).toBe(3);
  });

  it("labels overdue, today, and future rows by calendar day in the account timezone", async () => {
    const base = {
      lastName: null,
      avatarPath: null,
      cadenceDays: 7,
      lastInteractionAt: null,
    };
    findMany.mockResolvedValue([
      { ...base, id: "late", firstName: "Late", nextTouchAt: new Date("2026-03-06T17:00:00Z") },
      { ...base, id: "today", firstName: "Today", nextTouchAt: new Date("2026-03-08T04:59:00Z") },
      { ...base, id: "soon", firstName: "Soon", nextTouchAt: new Date("2026-03-09T16:00:00Z") },
    ]);

    const result = await getOverdueContacts("owner-1", "America/New_York");
    expect(result.map((contact) => contact.daysUntilDue)).toEqual([-1, 0, 2]);
  });
});
