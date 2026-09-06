import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

// The app's client, pointed at the throwaway database the rest of the suite
// uses. Without this the service writes to the development database, where the
// user this test just made does not exist.
vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

const { buildCalendarFeed } = await import("@/server/queries/calendar-feed");
const { getFeedStatus, hashFeedToken, issueFeedToken, resolveFeed, revokeFeed } = await import(
  "@/server/services/calendar-feed"
);

/**
 * The calendar subscription, driven against real rows.
 *
 * The feed is fetched by Google or Apple with no session, so it can never be
 * unlocked. Everything below asserts the consequence: what a permanently
 * closed lock leaves in the document, and what it must never leave in it.
 */
describe.skipIf(!hasTestDatabase)("calendar subscription feed", () => {
  const TZ = "America/New_York";
  let ownerId: string;

  async function contact(over: Record<string, unknown> = {}) {
    return prisma.contact.create({
      data: {
        ownerId,
        firstName: "Robin",
        lastName: "Vale",
        birthDate: new Date(Date.UTC(1990, 8, 20)),
        birthDatePrecision: "DAY",
        ...over,
      },
    });
  }

  function feedFor(id = ownerId) {
    return buildCalendarFeed(id, TZ, new Date("2026-09-06T12:00:00Z"));
  }

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    await prisma.userPreference.create({ data: { userId: ownerId, timezone: TZ } });
  });
  afterAll(() => prisma.$disconnect());

  describe("what the lock keeps out", () => {
    it("carries an ordinary contact's birthday", async () => {
      await contact();
      expect(await feedFor()).toContain("Robin Vale");
    });

    it("never carries a private contact's birthday", async () => {
      await contact({ isPrivate: true });
      const document = await feedFor();
      expect(document).not.toContain("Robin Vale");
      expect(document).not.toContain("Robin");
    });

    it("never carries a plan saved against a private contact", async () => {
      const hidden = await contact({ isPrivate: true });
      await prisma.plan.create({
        data: {
          ownerId,
          contactId: hidden.id,
          title: "Secret dinner",
          status: "PLANNED",
          plannedFor: new Date(Date.UTC(2026, 8, 20)),
        },
      });
      expect(await feedFor()).not.toContain("Secret dinner");
    });

    it("carries a plan saved against nobody", async () => {
      await prisma.plan.create({
        data: {
          ownerId,
          title: "Open evening",
          status: "PLANNED",
          plannedFor: new Date(Date.UTC(2026, 8, 20)),
        },
      });
      expect(await feedFor()).toContain("Open evening");
    });

    it("never carries a follow-up about a private contact", async () => {
      const hidden = await contact({ isPrivate: true });
      await prisma.task.create({
        data: {
          ownerId,
          contactId: hidden.id,
          title: "Quietly check in",
          dueDate: new Date(Date.UTC(2026, 8, 20)),
        },
      });
      expect(await feedFor()).not.toContain("Quietly check in");
    });

    it("never carries what a private contact has on", async () => {
      const hidden = await contact({ isPrivate: true });
      await prisma.happening.create({
        data: {
          ownerId,
          contactId: hidden.id,
          title: "Away for a fortnight",
          date: new Date(Date.UTC(2026, 8, 10)),
          precision: "DAY",
          endDate: new Date(Date.UTC(2026, 8, 20)),
          endPrecision: "DAY",
        },
      });
      expect(await feedFor()).not.toContain("Away for a fortnight");
    });

    it("is identical whether or not a browser session happens to be unlocked", async () => {
      // The proof that the feed does not read request state: there is no
      // session here at all, and marking the account's lock on changes nothing.
      await contact();
      const before = await feedFor();
      await prisma.user.update({ where: { id: ownerId }, data: { privacyPinHash: "pin" } });
      expect(await feedFor()).toBe(before);
    });
  });

  describe("the dating layer", () => {
    it("never carries a date log entry, nor the interaction beneath it", async () => {
      // A DateEntry hangs off an Interaction, which is what carries the title —
      // so the thing to prove absent is that interaction. It is absent because
      // interactions are not a feed source at all, which is also what stops a
      // date's own record from arriving by the back door.
      const person = await contact({ isRomantic: true });
      const interaction = await prisma.interaction.create({
        data: { ownerId, title: "Third date", occurredAt: new Date("2026-09-18T23:00:00Z") },
      });
      await prisma.interactionParticipant.create({
        data: { interactionId: interaction.id, ownerId, contactId: person.id },
      });
      await prisma.dateEntry.create({
        data: { ownerId, contactId: person.id, interactionId: interaction.id },
      });
      expect(await feedFor()).not.toContain("Third date");
    });

    it("does carry a plan naming a romantic contact, as the page does", async () => {
      // Documented rather than incidental: plans are deliberately not behind
      // the lock, and a romantic contact is not a private one. Marking the
      // person private is what removes them, which the next case proves.
      const person = await contact({ isRomantic: true });
      await prisma.plan.create({
        data: {
          ownerId,
          contactId: person.id,
          title: "Dinner out",
          status: "PLANNED",
          plannedFor: new Date(Date.UTC(2026, 8, 18)),
        },
      });
      expect(await feedFor()).toContain("Dinner out");
    });

    it("drops that same plan once the person is marked private", async () => {
      const person = await contact({ isRomantic: true, isPrivate: true });
      await prisma.plan.create({
        data: {
          ownerId,
          contactId: person.id,
          title: "Dinner out",
          status: "PLANNED",
          plannedFor: new Date(Date.UTC(2026, 8, 18)),
        },
      });
      expect(await feedFor()).not.toContain("Dinner out");
    });
  });

  describe("owner scoping", () => {
    it("never carries another account's entries", async () => {
      const other = await createTestUser();
      await prisma.contact.create({
        data: { ownerId: other.id, firstName: "Someone", lastName: "Else", birthDate: new Date(Date.UTC(1988, 2, 3)), birthDatePrecision: "DAY" },
      });
      expect(await feedFor()).not.toContain("Someone Else");
    });
  });

  describe("the document", () => {
    it("is a well-formed calendar even with nothing in it", async () => {
      const document = await feedFor();
      expect(document.startsWith("BEGIN:VCALENDAR")).toBe(true);
      expect(document.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
      expect(document).toContain("X-WR-CALNAME:Personal CRM");
      // CRLF line endings, as RFC 5545 requires.
      expect(document).toContain("\r\n");
    });

    it("leaves out interactions, which have already happened", async () => {
      const person = await contact();
      const interaction = await prisma.interaction.create({
        data: { ownerId, title: "Coffee last week", occurredAt: new Date("2026-09-01T15:00:00Z") },
      });
      await prisma.interactionParticipant.create({
        data: { interactionId: interaction.id, ownerId, contactId: person.id },
      });
      expect(await feedFor()).not.toContain("Coffee last week");
    });

    it("writes a timed plan in UTC, resolved against the account's zone", async () => {
      await prisma.plan.create({
        data: {
          ownerId,
          title: "Dinner out",
          status: "PLANNED",
          plannedFor: new Date(Date.UTC(2026, 8, 18)),
          plannedStartMinute: 19 * 60,
          plannedDurationMinutes: 90,
        },
      });
      const document = await feedFor();
      // 19:00 in New York in September is 23:00 UTC.
      expect(document).toContain("DTSTART:20260918T230000Z");
      expect(document).toContain("DTEND:20260919T003000Z");
    });

    it("folds a multi-day happening into one spanning event", async () => {
      const person = await contact({ isPrivate: false });
      await prisma.happening.create({
        data: {
          ownerId,
          contactId: person.id,
          title: "Away",
          date: new Date(Date.UTC(2026, 8, 10)),
          precision: "DAY",
          endDate: new Date(Date.UTC(2026, 8, 13)),
          endPrecision: "DAY",
        },
      });
      const document = await feedFor();
      const starts = document.match(/DTSTART;VALUE=DATE:20260910/g) ?? [];
      expect(starts).toHaveLength(1);
      // Exclusive end: the day after the last day covered.
      expect(document).toContain("DTEND;VALUE=DATE:20260914");
    });
  });

  describe("the token", () => {
    it("resolves to its owner and their timezone", async () => {
      const token = await issueFeedToken(ownerId);
      expect(await resolveFeed(token)).toEqual({ ownerId, timezone: TZ });
    });

    it("stores only a hash and a ciphertext, never the token itself", async () => {
      const token = await issueFeedToken(ownerId);
      const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { ownerId } });
      expect(row.tokenHash).toBe(hashFeedToken(token));
      expect(row.tokenHash).not.toContain(token);
      expect(row.token).not.toContain(token);
      // But it can still be shown back to the person who owns it.
      expect((await getFeedStatus(ownerId))?.token).toBe(token);
    });

    it("refuses a token it never issued", async () => {
      await issueFeedToken(ownerId);
      expect(await resolveFeed("not-a-real-token-but-long-enough")).toBeNull();
    });

    it("refuses lengths no token it issues could have", async () => {
      expect(await resolveFeed("")).toBeNull();
      expect(await resolveFeed("short")).toBeNull();
      expect(await resolveFeed("x".repeat(500))).toBeNull();
    });

    it("stops the old address the moment a new one is made", async () => {
      const first = await issueFeedToken(ownerId);
      const second = await issueFeedToken(ownerId);
      expect(first).not.toBe(second);
      expect(await resolveFeed(first)).toBeNull();
      expect(await resolveFeed(second)).not.toBeNull();
      // One account, one subscription.
      expect(await prisma.calendarFeed.count({ where: { ownerId } })).toBe(1);
    });

    it("stops working when the subscription is turned off", async () => {
      const token = await issueFeedToken(ownerId);
      await revokeFeed(ownerId);
      expect(await resolveFeed(token)).toBeNull();
      expect(await getFeedStatus(ownerId)).toBeNull();
    });

    it("refuses a deactivated account, the same as signing in would", async () => {
      const token = await issueFeedToken(ownerId);
      await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
      expect(await resolveFeed(token)).toBeNull();
    });

    it("goes with the account when it is deleted", async () => {
      await issueFeedToken(ownerId);
      await prisma.user.delete({ where: { id: ownerId } });
      expect(await prisma.calendarFeed.count()).toBe(0);
    });

    it("records the first fetch, then leaves it alone for an hour", async () => {
      const token = await issueFeedToken(ownerId);
      await resolveFeed(token);
      const first = await prisma.calendarFeed.findUniqueOrThrow({ where: { ownerId } });
      expect(first.lastAccessedAt).not.toBeNull();

      await resolveFeed(token);
      const second = await prisma.calendarFeed.findUniqueOrThrow({ where: { ownerId } });
      // A client polling every few minutes must not turn a read into a write.
      expect(second.lastAccessedAt?.getTime()).toBe(first.lastAccessedAt?.getTime());
    });

    it("records a fetch again once the interval has passed", async () => {
      const token = await issueFeedToken(ownerId);
      await prisma.calendarFeed.update({
        where: { ownerId },
        data: { lastAccessedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      });
      await resolveFeed(token);
      const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { ownerId } });
      expect(Date.now() - (row.lastAccessedAt?.getTime() ?? 0)).toBeLessThan(60_000);
    });

    it("clears the access record when a new address is issued", async () => {
      const token = await issueFeedToken(ownerId);
      await resolveFeed(token);
      await issueFeedToken(ownerId);
      const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { ownerId } });
      expect(row.lastAccessedAt).toBeNull();
    });
  });
});
