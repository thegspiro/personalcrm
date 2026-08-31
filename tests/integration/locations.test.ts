import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeLocationName } from "@/lib/locations";
import { interactionPrivacyWhere, type PrivacyScope } from "@/server/privacy/where";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const LOCKED: PrivacyScope = { enabled: true, unlocked: false };

describe.skipIf(!hasTestDatabase)("location history", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("keeps matching owner-specific and aggregates distinct visible people", async () => {
    const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
    const [one, two, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: a.id, firstName: "One" } }),
      prisma.contact.create({ data: { ownerId: a.id, firstName: "Two" } }),
      prisma.contact.create({ data: { ownerId: a.id, firstName: "Secret", isPrivate: true } }),
    ]);
    const normalizedName = normalizeLocationName("  Corner   Cafe ");
    const [place, otherPlace] = await Promise.all([
      prisma.location.create({ data: { ownerId: a.id, displayName: "Corner Cafe", normalizedName } }),
      prisma.location.create({ data: { ownerId: b.id, displayName: "Corner Cafe", normalizedName } }),
    ]);
    for (const row of [
      { contacts: [one.id, two.id], isPrivate: false, text: " Corner   Cafe " },
      { contacts: [one.id], isPrivate: false, text: "Corner Cafe" },
      { contacts: [one.id], isPrivate: true, text: "Corner Cafe" },
      { contacts: [secret.id], isPrivate: false, text: "Corner Cafe" },
    ]) await prisma.interaction.create({ data: { ownerId: a.id, occurredAt: new Date(), locationId: place.id, location: row.text, isPrivate: row.isPrivate, participants: { create: row.contacts.map((contactId) => ({ contactId })) } } });

    const visible = await prisma.interaction.findMany({ where: { ownerId: a.id, locationId: place.id, ...interactionPrivacyWhere(LOCKED) }, select: { location: true, participants: { select: { contactId: true } } } });
    expect(visible).toHaveLength(2);
    expect(new Set(visible.flatMap((visit) => visit.participants.map((p) => p.contactId))).size).toBe(2);
    expect(visible[0]?.location).toBe(" Corner   Cafe ");
    expect(otherPlace.ownerId).toBe(b.id);
    expect(place.id).not.toBe(otherPlace.id);
  });
});
