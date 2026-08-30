import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, daysAgo, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "" }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));
vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({ enabled: false, unlocked: true }),
  requireUnlocked: async () => ({ ok: true }),
}));

const { createPlan, updatePlan } = await import("@/server/actions/details");
const { listPlans } = await import("@/server/queries/plans");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
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
    state.ownerId = user.id;
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
        city: "Arlington",
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
  });

  it("creates, reads and updates an address without crossing owner boundaries", async () => {
    const other = await createTestUser();
    const created = await createPlan(
      form({
        title: "Late showing at the Alamo",
        location: "  Alamo Drafthouse  ",
        address: "  2900 Columbia Pike, Arlington, VA 22204  ",
        city: "  Arlington  ",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await prisma.plan.create({
      data: {
        ownerId: other.id,
        title: "Someone else's reservation",
        address: "1 Private Way",
      },
    });

    const visible = await listPlans(ownerId);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: created.data?.id,
      location: "Alamo Drafthouse",
      address: "2900 Columbia Pike, Arlington, VA 22204",
      city: "Arlington",
    });

    const updated = await updatePlan(
      form({
        id: created.data?.id ?? "",
        title: "Late showing at the Alamo",
        location: "Alamo Drafthouse",
        address: "2900 Columbia Pike, Arlington, VA 22204, United States",
        city: "Arlington",
      }),
    );
    expect(updated.ok).toBe(true);
    await expect(
      prisma.plan.findFirstOrThrow({ where: { id: created.data?.id, ownerId } }),
    ).resolves.toMatchObject({
      address: "2900 Columbia Pike, Arlington, VA 22204, United States",
    });

    state.ownerId = other.id;
    const blocked = await updatePlan(
      form({
        id: created.data?.id ?? "",
        title: "Stolen plan",
        address: "Changed by another owner",
      }),
    );
    expect(blocked).toMatchObject({ ok: false, error: "Not found." });
    await expect(
      prisma.plan.findUniqueOrThrow({ where: { id: created.data?.id } }),
    ).resolves.toMatchObject({
      title: "Late showing at the Alamo",
      address: "2900 Columbia Pike, Arlington, VA 22204, United States",
    });
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
});
