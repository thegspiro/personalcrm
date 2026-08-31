import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";
import { debtPrivacyWhere, viaContactPrivacyWhere, type PrivacyScope } from "@/server/privacy/where";
import { countPrivateRows } from "@/server/privacy/counts";

const LOCKED: PrivacyScope = { enabled: true, unlocked: false };
const UNLOCKED: PrivacyScope = { enabled: true, unlocked: true };
const OFF: PrivacyScope = { enabled: false, unlocked: true };

describe.skipIf(!hasTestDatabase)("debts, dietary needs and reaching out", () => {
  let ownerId: string;
  let publicContactId: string;
  let privateContactId: string;

  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    ownerId = user.id;

    const open = await prisma.contact.create({
      data: { ownerId, firstName: "Public", isPrivate: false },
    });
    const secret = await prisma.contact.create({
      data: { ownerId, firstName: "Secret", isPrivate: true },
    });
    publicContactId = open.id;
    privateContactId = secret.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function lend(contactId: string, isPrivate: boolean) {
    return prisma.debt.create({
      data: {
        ownerId,
        contactId,
        direction: "THEY_OWE_ME",
        description: "Covered dinner",
        amountCents: 4000,
        incurredOn: new Date("2026-06-01"),
        isPrivate,
      },
    });
  }

  it("withholds a private debt while the lock is closed", async () => {
    await lend(publicContactId, true);

    const locked = await prisma.debt.count({ where: { ownerId, ...debtPrivacyWhere(LOCKED) } });
    const unlocked = await prisma.debt.count({ where: { ownerId, ...debtPrivacyWhere(UNLOCKED) } });

    expect(locked).toBe(0);
    expect(unlocked).toBe(1);
  });

  it("withholds every debt belonging to a private contact", async () => {
    await lend(privateContactId, false);

    const locked = await prisma.debt.count({
      where: { ownerId, ...viaContactPrivacyWhere(LOCKED) },
    });
    expect(locked).toBe(0);
    expect(await prisma.debt.count({ where: { ownerId, ...viaContactPrivacyWhere(OFF) } })).toBe(1);
  });

  it("counts a private debt as something that must not be cached offline", async () => {
    // The trap this guards: offlineCacheable counted contacts, facts and
    // interactions only. A model gaining isPrivate without joining that count
    // leaves caching switched on and the private row written to disk.
    const before = await countPrivateRows(prisma, ownerId);
    await lend(publicContactId, true);
    expect(await countPrivateRows(prisma, ownerId)).toBe(before + 1);
  });

  it("hides a dietary need on a private contact even though it has no flag of its own", async () => {
    await prisma.dietaryNeed.create({
      data: { ownerId, contactId: privateContactId, kind: "ALLERGY", label: "Shellfish" },
    });

    const locked = await prisma.dietaryNeed.count({
      where: { ownerId, ...viaContactPrivacyWhere(LOCKED) },
    });
    expect(locked).toBe(0);
  });

  it("leaves a dietary need on an ordinary contact readable while locked", async () => {
    // Deliberate: an allergy behind a PIN is a decorative allergy.
    await prisma.dietaryNeed.create({
      data: { ownerId, contactId: publicContactId, kind: "ALLERGY", label: "Peanuts" },
    });

    const locked = await prisma.dietaryNeed.count({
      where: { ownerId, ...viaContactPrivacyWhere(LOCKED) },
    });
    expect(locked).toBe(1);
  });

  it("stores food, medication and environmental allergies as distinct categories", async () => {
    await prisma.dietaryNeed.createMany({ data: [
      { ownerId, contactId: publicContactId, kind: "ALLERGY", allergyCategory: "FOOD", label: "Peanuts" },
      { ownerId, contactId: publicContactId, kind: "ALLERGY", allergyCategory: "MEDICATION", label: "Penicillin" },
      { ownerId, contactId: publicContactId, kind: "ALLERGY", allergyCategory: "ENVIRONMENTAL", label: "Pollen" },
    ] });

    const rows = await prisma.dietaryNeed.findMany({
      where: { ownerId, ...viaContactPrivacyWhere(LOCKED) },
      orderBy: { label: "asc" },
    });
    expect(rows.map(({ allergyCategory }) => allergyCategory).sort()).toEqual([
      "ENVIRONMENTAL", "FOOD", "MEDICATION",
    ]);
  });

  it("leaves an ordinary debt out of the offline count", async () => {
    // Only the marker matters — an unmarked debt is not a reason to stop
    // caching the whole account.
    const before = await countPrivateRows(prisma, ownerId);
    await lend(publicContactId, false);
    expect(await countPrivateRows(prisma, ownerId)).toBe(before);
  });

  it("backfills existing interactions as UNSPECIFIED rather than guessing", async () => {
    const created = await prisma.interaction.create({
      data: { ownerId, occurredAt: new Date("2026-06-01"), title: "Coffee" },
    });

    const row = await prisma.interaction.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.reachedOutBy).toBe("UNSPECIFIED");
  });
});
