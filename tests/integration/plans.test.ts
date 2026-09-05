import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, daysAgo, hasTestDatabase, prisma, reset } from "./db";

// The time-of-day rules live in `planFields`, so those cases drive the real
// actions rather than Prisma. Everything else here stays a direct write.
const actionState = vi.hoisted(() => ({ ownerId: "", locked: false }));
vi.mock("@/server/db/client", async () => ({ prisma: (await import("./db")).prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: actionState.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: actionState.locked, unlocked: !actionState.locked }),
  recordProtectedReadActivity: async () => {},
  requireUnlocked: async () =>
    actionState.locked ? { ok: false, error: "Unlock to continue." } : { ok: true },
}));

const { completePlan, createPlan, schedulePlan, updatePlan } = await import(
  "@/server/actions/details"
);

function actionForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

/**
 * Plans — the things you mean to do with people.
 *
 * The rule these all circle: a plan is not a dating row. It hangs off any
 * contact, or off nobody, and nothing about it depends on the romantic layer.
 */
describe.skipIf(!hasTestDatabase)("plans", () => {
  let ownerId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;
    actionState.ownerId = user.id;
    actionState.locked = false;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeContact(firstName: string, isRomantic = false) {
    return prisma.contact.create({ data: { ownerId, firstName, isRomantic } });
  }

  async function category(slug: string) {
    return prisma.taxonomyTerm.findFirstOrThrow({
      where: { ownerId, kind: "PLAN_CATEGORY", slug },
    });
  }

  it("a new account gets plan categories, places and films among them", async () => {
    const slugs = (
      await prisma.taxonomyTerm.findMany({
        where: { ownerId, kind: "PLAN_CATEGORY" },
        select: { slug: true },
      })
    ).map((term) => term.slug);

    expect(slugs).toEqual(expect.arrayContaining(["place", "movie", "thing-to-try", "other"]));
  });

  it("a plan keeps its category, its place and what it might cost", async () => {
    const friend = await makeContact("Marcus");
    const movie = await category("movie");

    const plan = await prisma.plan.create({
      data: {
        ownerId,
        contactId: friend.id,
        title: "Late showing at the Alamo",
        categoryId: movie.id,
        location: "Alamo Drafthouse",
        address: "1660 Crystal Dr, Arlington, VA",
        checklist: [
          { id: "tickets", text: "Reserve or buy tickets", completed: false },
        ],
        url: "https://example.com/showtimes",
        estimatedCostCents: 4400,
      },
    });

    const stored = await prisma.plan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { category: true },
    });
    expect(stored.status).toBe("OPEN");
    expect(stored.category?.slug).toBe("movie");
    expect(stored.location).toBe("Alamo Drafthouse");
    expect(stored.estimatedCostCents).toBe(4400);
    expect(stored.address).toBe("1660 Crystal Dr, Arlington, VA");
    expect(stored.checklist).toEqual([
      { id: "tickets", text: "Reserve or buy tickets", completed: false },
    ]);
  });

  it("saves against a friend as readily as against a date", async () => {
    const friend = await makeContact("Marcus");
    const date = await makeContact("Elena", true);

    await prisma.plan.create({ data: { ownerId, contactId: friend.id, title: "Hike Old Rag" } });
    await prisma.plan.create({ data: { ownerId, contactId: date.id, title: "Cherry blossoms" } });

    const rows = await prisma.plan.findMany({
      where: { ownerId },
      include: { contact: { select: { firstName: true, isRomantic: true } } },
      orderBy: { title: "asc" },
    });

    // Nothing about the row changes with the person it names.
    expect(rows.map((row) => row.contact?.firstName)).toEqual(["Elena", "Marcus"]);
    expect(rows.map((row) => row.contact?.isRomantic)).toEqual([true, false]);
  });

  it("a plan saved against nobody outlives the person you saved it near", async () => {
    const friend = await makeContact("Marcus");
    await prisma.plan.create({
      data: { ownerId, contactId: friend.id, title: "Rooftop at the Wharf" },
    });
    const general = await prisma.plan.create({
      data: { ownerId, title: "Kayak the Potomac" },
    });

    await prisma.contact.delete({ where: { id: friend.id } });

    const left = await prisma.plan.findMany({ where: { ownerId }, select: { id: true } });
    expect(left.map((row) => row.id)).toEqual([general.id]);
  });

  it("deleting a category leaves the plan, uncategorised", async () => {
    const movie = await category("movie");
    const plan = await prisma.plan.create({
      data: { ownerId, title: "Whatever is on at the Avalon", categoryId: movie.id },
    });

    await prisma.taxonomyTerm.delete({ where: { id: movie.id } });

    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.categoryId).toBeNull();
    expect(after.title).toBe("Whatever is on at the Avalon");
  });

  it("carrying a plan out closes it and points it at the interaction", async () => {
    const friend = await makeContact("Marcus");
    const plan = await prisma.plan.create({
      data: { ownerId, contactId: friend.id, title: "Hike Old Rag" },
    });

    // An ordinary hangout, not a date: the link has to survive without a
    // DateEntry anywhere in sight.
    const interaction = await prisma.interaction.create({
      data: {
        ownerId,
        occurredAt: daysAgo(1),
        title: "Hike",
        participants: { create: [{ contactId: friend.id }] },
      },
    });

    await prisma.plan.update({
      where: { id: plan.id },
      data: { status: "DONE", usedAt: new Date(), usedInInteractionId: interaction.id },
    });

    const done = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(done.status).toBe("DONE");
    expect(done.usedInInteractionId).toBe(interaction.id);

    // Deleting what it became does not take the plan with it — only the link.
    await prisma.interaction.delete({ where: { id: interaction.id } });
    const orphaned = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(orphaned.usedInInteractionId).toBeNull();
    expect(orphaned.status).toBe("DONE");
  });

  it("a plan keeps the day, the time and how long to set aside", async () => {
    const created = await createPlan(
      actionForm({
        title: "Late showing at the Alamo",
        plannedFor: "2026-10-02",
        plannedStartTime: "19:30",
        plannedDurationMinutes: "150",
      }),
    );
    expect(created).toMatchObject({ ok: true });

    const plan = await prisma.plan.findFirstOrThrow({ where: { ownerId } });
    expect(plan.plannedFor?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(plan.plannedStartMinute).toBe(19 * 60 + 30);
    expect(plan.plannedDurationMinutes).toBe(150);
  });

  it("a plan with a day and no time is stored exactly as it was before", async () => {
    expect(
      await createPlan(actionForm({ title: "Go to the observatory", plannedFor: "2026-10-02" })),
    ).toMatchObject({ ok: true });

    const plan = await prisma.plan.findFirstOrThrow({ where: { ownerId } });
    expect(plan.plannedFor?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(plan.plannedStartMinute).toBeNull();
    expect(plan.plannedDurationMinutes).toBeNull();
  });

  it("drops a time that arrives without a day, rather than refusing the save", async () => {
    // A time on nothing is not a time, and refusing would make clearing the
    // day an error the user has to go and understand.
    expect(
      await createPlan(actionForm({ title: "Something", plannedStartTime: "19:30" })),
    ).toMatchObject({ ok: true });

    const plan = await prisma.plan.findFirstOrThrow({ where: { ownerId } });
    expect(plan.plannedFor).toBeNull();
    expect(plan.plannedStartMinute).toBeNull();
  });

  it("clears the time when the day is cleared on an edit", async () => {
    const created = await createPlan(
      actionForm({ title: "Dinner", plannedFor: "2026-10-02", plannedStartTime: "19:30" }),
    );
    const id = (created as { data?: { id: string } }).data!.id;

    expect(await updatePlan(actionForm({ id, title: "Dinner" }))).toMatchObject({ ok: true });

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id } });
    expect(plan.plannedFor).toBeNull();
    expect(plan.plannedStartMinute).toBeNull();
  });

  it("refuses a time it cannot read instead of filing the plan at midnight", async () => {
    const result = await createPlan(
      actionForm({ title: "Dinner", plannedFor: "2026-10-02", plannedStartTime: "half seven" }),
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.plan.count()).toBe(0);
  });

  it("keeps a duration chosen before there is a day to hang it on", async () => {
    // How long a thing takes belongs to the thing, not to the day. Only the
    // start time needs a day.
    expect(
      await createPlan(
        actionForm({ title: "Go to the observatory", plannedDurationMinutes: "240" }),
      ),
    ).toMatchObject({ ok: true });

    const plan = await prisma.plan.findFirstOrThrow({ where: { ownerId } });
    expect(plan.plannedFor).toBeNull();
    expect(plan.plannedStartMinute).toBeNull();
    expect(plan.plannedDurationMinutes).toBe(240);
  });

  it("refuses a malformed day rather than saving as though none was given", async () => {
    // `plainDate` answers undefined to both an empty field and "2026-02-30".
    // Folding them together saved a dateless plan and reported success, taking
    // the submitted time with it.
    const result = await createPlan(
      actionForm({
        title: "Dinner",
        plannedFor: "2026-02-30",
        plannedStartTime: "19:30",
      }),
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.plan.count()).toBe(0);
  });

  it("refuses a duration longer than a day", async () => {
    const result = await createPlan(
      actionForm({ title: "Dinner", plannedFor: "2026-10-02", plannedDurationMinutes: "1441" }),
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.plan.count()).toBe(0);
  });

  async function planFor(contactId: string | null, extra: Record<string, unknown> = {}) {
    return prisma.plan.create({
      data: {
        ownerId,
        contactId,
        title: "Go to the observatory",
        checklist: [{ id: "tickets", text: "Reserve or buy tickets", completed: true }],
        ...extra,
      },
    });
  }

  it("schedules a plan that already names someone where it stands", async () => {
    const friend = await makeContact("Marcus");
    const plan = await planFor(friend.id);

    expect(
      await schedulePlan(
        actionForm({ id: plan.id, plannedFor: "2026-10-02", plannedStartTime: "19:30" }),
      ),
    ).toMatchObject({ ok: true });

    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.status).toBe("PLANNED");
    expect(after.contactId).toBe(friend.id);
    expect(after.plannedStartMinute).toBe(19 * 60 + 30);
    expect(await prisma.plan.count()).toBe(1);
  });

  it("copies an Anyone plan rather than taking it out of everyone else's list", async () => {
    // `listPlans` offers a contactId-null plan on every person's page, so
    // scheduling it with one of them must not consume the shared one.
    const friend = await makeContact("Marcus");
    const plan = await planFor(null);

    const result = await schedulePlan(
      actionForm({
        id: plan.id,
        plannedFor: "2026-10-02",
        contactId: friend.id,
        keepInList: "true",
      }),
    );
    expect(result).toMatchObject({ ok: true });

    const original = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(original.status).toBe("OPEN");
    expect(original.contactId).toBeNull();
    expect(original.plannedFor).toBeNull();

    const copyId = (result as { data?: { id: string } }).data!.id;
    expect(copyId).not.toBe(plan.id);
    const copy = await prisma.plan.findUniqueOrThrow({ where: { id: copyId } });
    expect(copy.contactId).toBe(friend.id);
    expect(copy.status).toBe("PLANNED");
    expect(copy.title).toBe("Go to the observatory");
    // A copy arriving with "Reserve or buy tickets" already ticked would claim
    // something nobody did for this evening.
    expect(copy.checklist).toEqual([]);
  });

  it("moves an Anyone plan in place when the list copy is not wanted", async () => {
    const friend = await makeContact("Marcus");
    const plan = await planFor(null);

    expect(
      await schedulePlan(
        actionForm({ id: plan.id, plannedFor: "2026-10-02", contactId: friend.id }),
      ),
    ).toMatchObject({ ok: true });

    expect(await prisma.plan.count()).toBe(1);
    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.contactId).toBe(friend.id);
    expect(after.status).toBe("PLANNED");
  });

  it("completing a plan records what it became, for an ordinary friend", async () => {
    // The gap this closes: setPlanStatus(DONE) clears usedInInteractionId, and
    // only createDateEntry ever set it, so a hike with a friend ended as a
    // status and nothing else.
    const friend = await makeContact("Marcus");
    const plan = await planFor(friend.id, {
      plannedFor: new Date("2026-10-02T00:00:00.000Z"),
      plannedStartMinute: 19 * 60 + 30,
      location: "Rock Creek",
    });

    expect(await completePlan(actionForm({ id: plan.id }))).toMatchObject({ ok: true });

    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.status).toBe("DONE");
    expect(after.usedInInteractionId).not.toBeNull();

    const interaction = await prisma.interaction.findUniqueOrThrow({
      where: { id: after.usedInInteractionId! },
      include: { participants: true },
    });
    expect(interaction.title).toBe("Go to the observatory");
    expect(interaction.location).toBe("Rock Creek");
    expect(interaction.participants.map((p) => p.contactId)).toEqual([friend.id]);
    // The day and time already on the row, resolved in the account's zone —
    // 19:30 in New York on a standard-time day.
    expect(interaction.occurredAt.toISOString()).toBe("2026-10-02T23:30:00.000Z");
  });

  it("never writes a DateEntry, even for someone romantic", async () => {
    // Plans are deliberately not behind the privacy lock; DateEntry is. Writing
    // one from here would be a way round the lock.
    const partner = await makeContact("Robin", true);
    const plan = await planFor(partner.id);

    expect(await completePlan(actionForm({ id: plan.id }))).toMatchObject({ ok: true });

    expect(await prisma.dateEntry.count()).toBe(0);
    expect(await prisma.interaction.count()).toBe(1);
  });

  it("completing a plan saved for nobody closes it without an orphan interaction", async () => {
    const plan = await planFor(null);

    expect(await completePlan(actionForm({ id: plan.id }))).toMatchObject({ ok: true });

    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.status).toBe("DONE");
    expect(after.usedAt).not.toBeNull();
    expect(await prisma.interaction.count()).toBe(0);
  });

  it("completing a plan pencilled in for the past does not read as spoke today", async () => {
    // Invariant 1. The cadence has to come from the full history, not from the
    // row just written.
    const friend = await makeContact("Marcus");
    await prisma.contact.update({ where: { id: friend.id }, data: { cadenceDays: 7 } });
    const plan = await planFor(friend.id, { plannedFor: daysAgo(40) });

    expect(await completePlan(actionForm({ id: plan.id }))).toMatchObject({ ok: true });

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: friend.id } });
    expect(after.lastInteractionAt).not.toBeNull();
    const daysSince = Math.round(
      (Date.now() - after.lastInteractionAt!.getTime()) / 86_400_000,
    );
    expect(daysSince).toBeGreaterThan(30);
  });

  it("refuses to schedule or complete another owner's plan", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.plan.create({
      data: { ownerId: stranger.id, title: "Not mine" },
    });

    expect(
      await schedulePlan(actionForm({ id: theirs.id, plannedFor: "2026-10-02" })),
    ).toMatchObject({ ok: false, error: "Not found." });
    expect(await completePlan(actionForm({ id: theirs.id }))).toMatchObject({
      ok: false,
      error: "Not found.",
    });

    const after = await prisma.plan.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.status).toBe("OPEN");
  });
});
