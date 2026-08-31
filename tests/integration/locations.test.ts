import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeLocationName } from "@/server/services/locations";
import { interactionPrivacyWhere, type PrivacyScope } from "@/server/privacy/where";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const LOCKED: PrivacyScope = { enabled: true, unlocked: false };
const UNLOCKED: PrivacyScope = { enabled: true, unlocked: true };

/**
 * A place page aggregates whoever was there, so it is a second way to reach
 * every visit — and therefore a second way to leak one. These assert the lock
 * against the location relation rather than the timeline it was written for.
 */
describe.skipIf(!hasTestDatabase)("location history", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("withholds private visits and visits with a private participant while locked", async () => {
    const owner = await createTestUser();
    const [ada, grace, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Ada" } }),
      prisma.contact.create({ data: { ownerId: owner.id, firstName: "Grace" } }),
      prisma.contact.create({
        data: { ownerId: owner.id, firstName: "Secret", isPrivate: true },
      }),
    ]);

    const name = "Corner Cafe";
    const place = await prisma.location.create({
      data: { ownerId: owner.id, name, normalizedName: normalizeLocationName(name) },
    });

    const visits = [
      // Visible: nothing private about it or the people on it.
      { contacts: [ada.id, grace.id], isPrivate: false, label: " Corner   Cafe " },
      { contacts: [ada.id], isPrivate: false, label: "Corner Cafe" },
      // Withheld: marked private.
      { contacts: [ada.id], isPrivate: true, label: "Corner Cafe" },
      // Withheld: never marked, but a private person was there. Aggregating by
      // place must not be the thing that discloses them.
      { contacts: [secret.id], isPrivate: false, label: "Corner Cafe" },
    ];
    for (const visit of visits) {
      await prisma.interaction.create({
        data: {
          ownerId: owner.id,
          occurredAt: new Date(),
          locationId: place.id,
          location: visit.label,
          isPrivate: visit.isPrivate,
          participants: { create: visit.contacts.map((contactId) => ({ contactId })) },
        },
      });
    }

    const visible = await prisma.interaction.findMany({
      where: { ownerId: owner.id, locationId: place.id, ...interactionPrivacyWhere(LOCKED) },
      select: { location: true, participants: { select: { contactId: true } } },
    });

    expect(visible).toHaveLength(2);
    const seen = new Set(
      visible.flatMap((visit) => visit.participants.map((row) => row.contactId)),
    );
    expect(seen).toEqual(new Set([ada.id, grace.id]));
    expect(seen.has(secret.id)).toBe(false);

    // The count itself is a disclosure: it must not shift on unlock alone.
    const all = await prisma.interaction.findMany({
      where: { ownerId: owner.id, locationId: place.id, ...interactionPrivacyWhere(UNLOCKED) },
      select: { id: true },
    });
    expect(all).toHaveLength(4);
  });

  it("keeps the entered label rather than rewriting it to the canonical name", async () => {
    const owner = await createTestUser();
    const name = "Corner Cafe";
    const place = await prisma.location.create({
      data: { ownerId: owner.id, name, normalizedName: normalizeLocationName(name) },
    });
    await prisma.interaction.create({
      data: {
        ownerId: owner.id,
        occurredAt: new Date(),
        locationId: place.id,
        location: " Corner   Cafe ",
      },
    });

    const [visit] = await prisma.interaction.findMany({
      where: { ownerId: owner.id, locationId: place.id },
      select: { location: true },
    });
    expect(visit?.location).toBe(" Corner   Cafe ");
  });

  it("does not merge identically named places belonging to different owners", async () => {
    const [one, two] = await Promise.all([createTestUser(), createTestUser()]);
    const name = "Corner Cafe";
    const normalizedName = normalizeLocationName(name);

    const [mine, theirs] = await Promise.all([
      prisma.location.create({ data: { ownerId: one.id, name, normalizedName } }),
      prisma.location.create({ data: { ownerId: two.id, name, normalizedName } }),
    ]);

    // The uniqueness is on (ownerId, normalizedName), so the same real-world
    // spelling in two accounts stays two rows.
    expect(mine.id).not.toBe(theirs.id);
    expect(await prisma.location.count({ where: { ownerId: one.id } })).toBe(1);
  });
});
