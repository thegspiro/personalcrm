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

const { createPlan, updatePlan } = await import("@/server/actions/details");

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

  it("refuses a duration longer than a day", async () => {
    const result = await createPlan(
      actionForm({ title: "Dinner", plannedFor: "2026-10-02", plannedDurationMinutes: "1441" }),
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.plan.count()).toBe(0);
  });
});
