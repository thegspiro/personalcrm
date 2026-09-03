import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: true,
  unlocked: false,
  acceptedPin: "482913",
}));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

vi.mock("@/server/privacy/lock", () => ({
  clearPin: vi.fn(),
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  lock: vi.fn(),
  // privacyScope() extends a live unlock on every protected read; without it
  // in the mock every scoped query throws instead of being scoped.
  recordProtectedReadActivity: async () => ({ ok: true, expiresAt: null }),
  requireUnlocked: vi.fn(),
  setPin: vi.fn(),
  unlock: async (pin: string) =>
    pin === state.acceptedPin ? { ok: true } : { ok: false, error: "That PIN is wrong." },
}));

const { setPrivacyLockEnabled, updatePrivacyPreferences } = await import(
  "@/server/actions/privacy"
);
const { updateDebt, settleDebt, deleteDebt } = await import("@/server/actions/details");
const { updateInteraction, deleteInteraction } = await import(
  "@/server/actions/interactions"
);
const { createHousehold } = await import("@/server/actions/family");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe.skipIf(!hasTestDatabase)("privacy preference actions", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = true;
    state.unlocked = false;
    await prisma.user.update({ where: { id: user.id }, data: { privacyPinHash: "configured" } });
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        timezone: "America/New_York",
        privacyLockEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const lockEnabled = async () =>
    (await prisma.userPreference.findUniqueOrThrow({ where: { userId: state.ownerId } }))
      .privacyLockEnabled;

  it("does not let general preference form data disable the lock", async () => {
    const result = await updatePrivacyPreferences(
      form({ privacyLockEnabled: "false", hideDating: "false", blurPrivateNotes: "false" }),
    );

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(true);
  });

  it("refuses a direct disable call from a locked session without the PIN", async () => {
    const result = await setPrivacyLockEnabled(form({ enabled: "false" }));

    expect(result).toEqual({ ok: false, error: "Unlock with your PIN first." });
    expect(await lockEnabled()).toBe(true);
  });

  it("refuses a direct disable call with the wrong PIN", async () => {
    const result = await setPrivacyLockEnabled(
      form({ enabled: "false", currentPin: "000000" }),
    );

    expect(result).toEqual({ ok: false, error: "That PIN is wrong." });
    expect(await lockEnabled()).toBe(true);
  });

  it("allows a direct disable call with the verified PIN", async () => {
    const result = await setPrivacyLockEnabled(
      form({ enabled: "false", currentPin: state.acceptedPin }),
    );

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(false);
  });

  it("allows an unlocked privacy session to disable without resubmitting the PIN", async () => {
    state.unlocked = true;

    const result = await setPrivacyLockEnabled(form({ enabled: "false" }));

    expect(result.ok).toBe(true);
    expect(await lockEnabled()).toBe(false);
  });
});

describe.skipIf(!hasTestDatabase)("locked mutation privacy", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.enabled = true;
    state.unlocked = false;
  });

  async function contact(isPrivate = false) {
    return prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: isPrivate ? "Private" : "Public", isPrivate },
    });
  }

  function interactionForm(id: string, contactId: string, title: string) {
    const data = form({ id, occurredAt: "2026-08-20T12:00:00.000Z", title });
    data.append("contactIds", contactId);
    return data;
  }

  it("blocks every mutation of a private row while locked and allows them unlocked", async () => {
    const person = await contact();
    const makeDebt = (description: string) =>
      prisma.debt.create({
        data: {
          ownerId: state.ownerId,
          contactId: person.id,
          direction: "THEY_OWE_ME",
          description,
          incurredOn: new Date("2026-08-01T00:00:00.000Z"),
          isPrivate: true,
        },
      });
    const edited = await makeDebt("edit me");
    const settled = await makeDebt("settle me");
    const deleted = await makeDebt("delete me");

    expect(await updateDebt(form({ id: edited.id, description: "changed", isPrivate: "true" }))).toMatchObject({ ok: false });
    expect(await settleDebt(settled.id, new Date("2026-08-02T00:00:00.000Z"))).toMatchObject({ ok: false });
    expect(await deleteDebt(deleted.id)).toMatchObject({ ok: false });

    state.unlocked = true;
    expect(await updateDebt(form({ id: edited.id, description: "changed", isPrivate: "true" }))).toEqual({ ok: true, data: undefined });
    expect(await settleDebt(settled.id, new Date("2026-08-02T00:00:00.000Z"))).toEqual({ ok: true, data: undefined });
    expect(await deleteDebt(deleted.id)).toEqual({ ok: true, data: undefined });
  });

  it.each(["participant", "mention"] as const)(
    "blocks editing and deleting an interaction with a private %s, then allows both unlocked",
    async (relation) => {
      const publicPerson = await contact();
      const privatePerson = await contact(true);
      const makeInteraction = (title: string) =>
        prisma.interaction.create({
          data: {
            ownerId: state.ownerId,
            occurredAt: new Date("2026-08-20T12:00:00.000Z"),
            title,
            participants: {
              create: [{ contactId: relation === "participant" ? privatePerson.id : publicPerson.id }],
            },
            mentions: {
              create: relation === "mention" ? [{ contactId: privatePerson.id }] : [],
            },
          },
        });
      const edited = await makeInteraction("edit me");
      const deleted = await makeInteraction("delete me");
      const participantId = relation === "participant" ? privatePerson.id : publicPerson.id;

      expect(await updateInteraction(interactionForm(edited.id, participantId, "changed"))).toMatchObject({ ok: false });
      expect(await deleteInteraction(deleted.id)).toMatchObject({ ok: false });

      state.unlocked = true;
      expect(await updateInteraction(interactionForm(edited.id, participantId, "changed"))).toEqual({ ok: true, data: undefined });
      expect(await deleteInteraction(deleted.id)).toEqual({ ok: true, data: undefined });
    },
  );

  it("preserves cross-owner rejection while unlocked", async () => {
    const other = await createTestUser();
    const person = await prisma.contact.create({ data: { ownerId: other.id, firstName: "Other" } });
    const debt = await prisma.debt.create({
      data: {
        ownerId: other.id,
        contactId: person.id,
        direction: "THEY_OWE_ME",
        description: "not mine",
        incurredOn: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    state.unlocked = true;

    expect(await settleDebt(debt.id, new Date("2026-08-02T00:00:00.000Z"))).toMatchObject({ ok: false });
    expect(await deleteDebt(debt.id)).toMatchObject({ ok: false });
  });

  it("refuses a household whose member list the lock has cut down", async () => {
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = true;
    const [visible, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Dana" } }),
      prisma.contact.create({
        data: { ownerId: owner.id, firstName: "Robin", isPrivate: true },
      }),
    ]);

    // The form is filled in with both while unlocked; the lock closes in
    // another tab before it is submitted. Saving the visible half reported
    // success and created a household missing a member its owner had just
    // ticked, with nothing on screen to say so.
    state.unlocked = false;
    const data = new FormData();
    data.set("name", "Home");
    data.append("memberIds", visible.id);
    data.append("memberIds", secret.id);
    const partial = await createHousehold(data);

    expect(partial.ok).toBe(false);
    expect(await prisma.household.count({ where: { ownerId: owner.id } })).toBe(0);

    // Unlocked, the same submission saves with everyone on it.
    state.unlocked = true;
    const saved = await createHousehold(data);
    expect(saved.ok).toBe(true);
    expect(
      await prisma.householdMember.count({
        where: { household: { ownerId: owner.id } },
      }),
    ).toBe(2);
  });
});
