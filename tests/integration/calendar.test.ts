import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";
import { plainDateToDb, zonedTimeOfDay } from "@/lib/dates";

const state = vi.hoisted(() => ({ locked: false }));
vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: state.locked, unlocked: !state.locked }),
  recordProtectedReadActivity: async () => {},
}));

const { getCalendarEntries } = await import("@/server/queries/calendar");

/**
 * The calendar's query — five sources, one window.
 *
 * The two things worth testing here are the two that cannot be seen by reading
 * the component: where the window's edges actually fall once a timezone is
 * involved, and whether the lock reaches every one of the five sources. Five
 * sources means five chances to forget a where-fragment, and forgetting one is
 * silent.
 */
describe.skipIf(!hasTestDatabase)("calendar", () => {
  let ownerId: string;

  /** Deliberately not UTC, and deliberately behind it, so a local evening is
   * the next day in UTC — the arrangement that catches a bound computed
   * against the server clock instead of the account's zone. */
  const TZ = "America/New_York";

  /** March 2026, Sunday-first: the grid runs 1 March to 11 April. */
  const WINDOW = {
    from: { year: 2026, month: 3, day: 1 },
    to: { year: 2026, month: 4, day: 11 },
  };

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    state.locked = false;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeContact(firstName: string, extra: Record<string, unknown> = {}) {
    return prisma.contact.create({ data: { ownerId, firstName, ...extra } });
  }

  async function entries() {
    return getCalendarEntries(ownerId, TZ, WINDOW);
  }

  it("puts a late local evening on the day it was local, not the day it was in UTC", async () => {
    // 23:30 on the last day of the window, in New York, is 03:30 the next day
    // in UTC. A bound built from the server clock would push it out of the
    // window entirely, and a day worked out from the raw instant would file it
    // on the 12th — a day the grid does not draw.
    const friend = await makeContact("Marcus");
    const lateNight = zonedTimeOfDay({ year: 2026, month: 4, day: 11 }, 23 * 60 + 30, TZ);
    expect(lateNight.toISOString()).toBe("2026-04-12T03:30:00.000Z");

    await prisma.interaction.create({
      data: {
        ownerId,
        title: "Late one",
        occurredAt: lateNight,
        participants: { create: [{ contactId: friend.id }] },
      },
    });

    const found = (await entries()).filter((entry) => entry.kind === "interaction");
    expect(found).toHaveLength(1);
    expect(found[0].day).toEqual({ year: 2026, month: 4, day: 11 });
  });

  it("leaves out the first local moment after the window closes", async () => {
    const friend = await makeContact("Marcus");
    await prisma.interaction.create({
      data: {
        ownerId,
        title: "Just too late",
        occurredAt: zonedTimeOfDay({ year: 2026, month: 4, day: 12 }, 0, TZ),
        participants: { create: [{ contactId: friend.id }] },
      },
    });

    expect((await entries()).filter((entry) => entry.kind === "interaction")).toHaveLength(0);
  });

  it("includes the first local moment the window opens", async () => {
    const friend = await makeContact("Marcus");
    await prisma.interaction.create({
      data: {
        ownerId,
        title: "Bang on",
        occurredAt: zonedTimeOfDay({ year: 2026, month: 3, day: 1 }, 0, TZ),
        participants: { create: [{ contactId: friend.id }] },
      },
    });

    const found = (await entries()).filter((entry) => entry.kind === "interaction");
    expect(found).toHaveLength(1);
    expect(found[0].day).toEqual({ year: 2026, month: 3, day: 1 });
  });

  it("gathers all five kinds of dated thing", async () => {
    const friend = await makeContact("Marcus", {
      birthDate: plainDateToDb({ year: 1990, month: 3, day: 14 }),
      birthDatePrecision: "DAY",
    });

    await prisma.plan.create({
      data: {
        ownerId,
        contactId: friend.id,
        title: "Observatory",
        plannedFor: plainDateToDb({ year: 2026, month: 3, day: 4 }),
        plannedStartMinute: 1170,
        status: "PLANNED",
      },
    });
    await prisma.importantDate.create({
      data: {
        ownerId,
        contactId: friend.id,
        label: "Anniversary",
        date: plainDateToDb({ year: 2019, month: 3, day: 6 }),
        precision: "DAY",
        recurrence: "ANNUAL",
      },
    });
    await prisma.task.create({
      data: {
        ownerId,
        contactId: friend.id,
        title: "Send the photos",
        dueDate: plainDateToDb({ year: 2026, month: 3, day: 9 }),
      },
    });
    await prisma.happening.create({
      data: {
        ownerId,
        contactId: friend.id,
        title: "Away for work",
        date: plainDateToDb({ year: 2026, month: 3, day: 16 }),
        precision: "DAY",
        endDate: plainDateToDb({ year: 2026, month: 3, day: 18 }),
        endPrecision: "DAY",
      },
    });
    await prisma.interaction.create({
      data: {
        ownerId,
        title: "Coffee",
        occurredAt: zonedTimeOfDay({ year: 2026, month: 3, day: 20 }, 600, TZ),
        participants: { create: [{ contactId: friend.id }] },
      },
    });

    const found = await entries();
    const kinds = new Set(found.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(["plan", "date", "task", "happening", "interaction"]));

    // The birthday is projected onto this year, from a 1990 anchor.
    const birthday = found.find((entry) => entry.title === "Birthday");
    expect(birthday?.day).toEqual({ year: 2026, month: 3, day: 14 });

    // A multi-day happening covers each of its days, because that is what being
    // away from the 16th to the 18th looks like on a calendar.
    const away = found.filter((entry) => entry.kind === "happening");
    expect(away.map((entry) => entry.day.day)).toEqual([16, 17, 18]);

    // Sorted by day, then by time, then by title — stable between renders
    // rather than however the five queries happened to come back.
    const days = found.map((entry) => entry.day.month * 100 + entry.day.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("shows a birthday in a month that has already gone by", async () => {
    // `projectDateOccurrences` clamps its lower bound to the `today` it is
    // given, so the dashboard cannot turn a past date into an upcoming one.
    // A calendar showing last March has to show last March's birthdays, so the
    // window's own start is passed as `today`. This is that behaviour.
    await makeContact("Marcus", {
      birthDate: plainDateToDb({ year: 1990, month: 3, day: 14 }),
      birthDatePrecision: "DAY",
    });

    const past = await getCalendarEntries(ownerId, TZ, {
      from: { year: 2020, month: 3, day: 1 },
      to: { year: 2020, month: 3, day: 31 },
    });
    const birthday = past.find((entry) => entry.title === "Birthday");
    expect(birthday?.day).toEqual({ year: 2020, month: 3, day: 14 });
  });

  it("keeps a date nobody can place off the grid", async () => {
    // Invariant 8: storing "in 2019" as a specific Tuesday turns a vague memory
    // into a confident-looking lie, and a grid square is exactly that.
    const friend = await makeContact("Marcus");
    await prisma.importantDate.create({
      data: {
        ownerId,
        contactId: friend.id,
        label: "Met sometime that year",
        date: plainDateToDb({ year: 2019, month: 1, day: 1 }),
        precision: "YEAR",
        recurrence: "NONE",
      },
    });

    expect((await entries()).filter((entry) => entry.kind === "date")).toHaveLength(0);
  });

  it("withholds every kind belonging to a private contact while locked", async () => {
    const secret = await makeContact("Robin", {
      isPrivate: true,
      birthDate: plainDateToDb({ year: 1990, month: 3, day: 14 }),
      birthDatePrecision: "DAY",
    });

    await prisma.plan.create({
      data: {
        ownerId,
        contactId: secret.id,
        title: "Observatory",
        plannedFor: plainDateToDb({ year: 2026, month: 3, day: 4 }),
        status: "PLANNED",
      },
    });
    await prisma.importantDate.create({
      data: {
        ownerId,
        contactId: secret.id,
        label: "Anniversary",
        date: plainDateToDb({ year: 2019, month: 3, day: 6 }),
        precision: "DAY",
        recurrence: "ANNUAL",
      },
    });
    await prisma.task.create({
      data: {
        ownerId,
        contactId: secret.id,
        title: "Send the photos",
        dueDate: plainDateToDb({ year: 2026, month: 3, day: 9 }),
      },
    });
    await prisma.happening.create({
      data: {
        ownerId,
        contactId: secret.id,
        title: "Away for work",
        date: plainDateToDb({ year: 2026, month: 3, day: 16 }),
        precision: "DAY",
      },
    });
    await prisma.interaction.create({
      data: {
        ownerId,
        title: "Coffee",
        occurredAt: zonedTimeOfDay({ year: 2026, month: 3, day: 20 }, 600, TZ),
        participants: { create: [{ contactId: secret.id }] },
      },
    });

    expect(await entries()).not.toHaveLength(0);

    state.locked = true;
    // Not "fewer" — none. A count that shifts on unlock is itself a
    // disclosure, so every one of the five has to be filtered, not just the
    // ones with an obvious marker.
    expect(await entries()).toHaveLength(0);
  });

  it("keeps a plan saved against nobody visible while locked", async () => {
    // A plan inherits the privacy of the person it names, and one saved against
    // nobody has no one to be private. Withholding it would hide the user's own
    // list from them behind a PIN.
    await prisma.plan.create({
      data: {
        ownerId,
        title: "Observatory",
        plannedFor: plainDateToDb({ year: 2026, month: 3, day: 4 }),
        status: "PLANNED",
      },
    });

    state.locked = true;
    const found = (await entries()).filter((entry) => entry.kind === "plan");
    expect(found).toHaveLength(1);
    expect(found[0].contact).toBeNull();
  });

  it("never reaches into another account", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.contact.create({
      data: { ownerId: stranger.id, firstName: "Nobody" },
    });
    await prisma.plan.create({
      data: {
        ownerId: stranger.id,
        contactId: theirs.id,
        title: "Not mine",
        plannedFor: plainDateToDb({ year: 2026, month: 3, day: 4 }),
        status: "PLANNED",
      },
    });
    await prisma.task.create({
      data: {
        ownerId: stranger.id,
        contactId: theirs.id,
        title: "Not mine either",
        dueDate: plainDateToDb({ year: 2026, month: 3, day: 9 }),
      },
    });

    expect(await entries()).toHaveLength(0);
  });
});
