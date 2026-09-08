import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  enabled: true,
  unlocked: false,
}));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    timezone: "America/New_York",
    prefs: {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: true,
    enabled: state.enabled,
    unlocked: state.unlocked,
    expiresAt: null,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => ({ ok: false }) as const,
}));

const { createLifeEvent, deleteLifeEvent, updateLifeEvent } = await import(
  "@/server/actions/details"
);
const { getLocation, listLocations, listLocationOptions } = await import(
  "@/server/queries/locations"
);
const { normalizeLocationName } = await import("@/server/services/locations");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/**
 * A life event can name a place, and that place is the same row an interaction
 * naming it would resolve to — the whole point of resolving rather than storing
 * a second string.
 */
describe.skipIf(!hasTestDatabase)("a life event's place", () => {
  let contactId = "";

  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
    const contact = await prisma.contact.create({
      data: { ownerId: owner.id, firstName: "Ada" },
    });
    contactId = contact.id;
  });

  afterAll(() => prisma.$disconnect());

  it("stores the resolved row beside the words that were typed", async () => {
    const created = await createLifeEvent(
      form({
        contactId,
        title: "Moved to Austin",
        date: "2019-06-01",
        datePrecision: "DAY",
        // Padded on purpose. `str` trims the ends, so what is kept is the
        // label as entered minus the padding — the inner run of spaces
        // survives, and only the resolved row normalises it away.
        location: "  Corner   Cafe  ",
      }),
    );
    expect(created.ok).toBe(true);

    const stored = await prisma.lifeEvent.findFirstOrThrow({
      where: { ownerId: state.ownerId },
      select: { location: true, locationId: true },
    });
    expect(stored.location).toBe("Corner   Cafe");
    expect(stored.locationId).toBeTruthy();

    const place = await prisma.location.findFirstOrThrow({
      where: { id: stored.locationId! },
    });
    expect(place.name).toBe("Corner Cafe");
    expect(place.normalizedName).toBe(normalizeLocationName("Corner Cafe"));
  });

  it("resolves to the same row an interaction naming it already made", async () => {
    const place = await prisma.location.create({
      data: {
        ownerId: state.ownerId,
        name: "Corner Cafe",
        normalizedName: normalizeLocationName("Corner Cafe"),
      },
    });
    await prisma.interaction.create({
      data: {
        ownerId: state.ownerId,
        occurredAt: new Date(),
        locationId: place.id,
        location: "Corner Cafe",
      },
    });

    await createLifeEvent(
      form({
        contactId,
        title: "Got engaged",
        date: "2020-02-14",
        datePrecision: "DAY",
        location: "corner cafe",
      }),
    );

    // One place, not two. A second row here would split one history in half.
    const places = await prisma.location.findMany({
      where: { ownerId: state.ownerId },
    });
    expect(places).toHaveLength(1);
    const event = await prisma.lifeEvent.findFirstOrThrow({
      where: { ownerId: state.ownerId },
    });
    expect(event.locationId).toBe(place.id);
  });

  it("keeps the place when only the title is edited", async () => {
    const created = await createLifeEvent(
      form({
        contactId,
        title: "Moved to Austin",
        date: "2019-06-01",
        datePrecision: "DAY",
        location: "Corner Cafe",
      }),
    );
    const id = (created.data as { id: string }).id;
    const before = await prisma.lifeEvent.findUniqueOrThrow({ where: { id } });

    // The form always posts the box, so a corrected title carries the place
    // back with it. `updateLifeEvent` writes every field it is given, which is
    // why the field has to be on both forms.
    await updateLifeEvent(
      form({
        id,
        title: "Moved to Austin, TX",
        date: "2019-06-01",
        datePrecision: "DAY",
        location: "Corner Cafe",
      }),
    );

    const after = await prisma.lifeEvent.findUniqueOrThrow({ where: { id } });
    expect(after.title).toBe("Moved to Austin, TX");
    expect(after.locationId).toBe(before.locationId);
    expect(after.location).toBe("Corner Cafe");
  });

  it("clears the place when the box is emptied, without touching the place itself", async () => {
    const created = await createLifeEvent(
      form({
        contactId,
        title: "Moved to Austin",
        date: "2019-06-01",
        datePrecision: "DAY",
        location: "Corner Cafe",
      }),
    );
    const id = (created.data as { id: string }).id;

    await updateLifeEvent(
      form({ id, title: "Moved to Austin", date: "2019-06-01", datePrecision: "DAY" }),
    );

    const after = await prisma.lifeEvent.findUniqueOrThrow({ where: { id } });
    expect(after.locationId).toBeNull();
    expect(after.location).toBeNull();
    // Nothing is destroyed by a status change: the place stands on its own.
    expect(await prisma.location.count({ where: { ownerId: state.ownerId } })).toBe(1);
  });

  it("leaves the place standing when the event is deleted", async () => {
    const created = await createLifeEvent(
      form({
        contactId,
        title: "Moved to Austin",
        date: "2019-06-01",
        datePrecision: "DAY",
        location: "Corner Cafe",
      }),
    );
    const id = (created.data as { id: string }).id;

    expect((await deleteLifeEvent(id)).ok).toBe(true);
    expect(await prisma.location.count({ where: { ownerId: state.ownerId } })).toBe(1);
  });

  it("makes a life-event-only place visible, and withholds a private one", async () => {
    await createLifeEvent(
      form({
        contactId,
        title: "Moved to Austin",
        date: "2019-06-01",
        datePrecision: "DAY",
        location: "Corner Cafe",
      }),
    );

    // Reached only through a life event — no interaction, no plan. Without the
    // third clause in `locationVisibleWhere` this place would render on the
    // profile and be unfindable in the directory.
    const [listed] = await listLocations(state.ownerId);
    expect(listed.name).toBe("Corner Cafe");
    expect(listed.lifeEventCount).toBe(1);
    expect(listed.visitCount).toBe(0);
    // And its own page resolves, rather than 404ing from a directory link.
    expect(await getLocation(state.ownerId, listed.id)).not.toBeNull();
    // The parser's vocabulary agrees with the directory.
    expect((await listLocationOptions(state.ownerId)).map((row) => row.name)).toEqual([
      "Corner Cafe",
    ]);
  });

  it("withholds a place known only through a private contact's life event", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    await createLifeEvent(
      form({
        contactId: secret.id,
        title: "Moved in together",
        date: "2021-03-01",
        datePrecision: "DAY",
        location: "The Hideaway",
      }),
    );

    // Listing it with no visits would announce that something happened
    // somewhere to somebody who cannot be shown.
    expect(await listLocations(state.ownerId)).toEqual([]);
    expect(await listLocationOptions(state.ownerId)).toEqual([]);

    state.unlocked = true;
    expect((await listLocations(state.ownerId)).map((row) => row.name)).toEqual([
      "The Hideaway",
    ]);
  });

  it("withholds a place whose only life event has a private participant", async () => {
    const [ada, secret] = await Promise.all([
      prisma.contact.create({ data: { ownerId: state.ownerId, firstName: "Bo" } }),
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      }),
    ]);

    // The anchor contact is public; the person it is about is not. Filtering on
    // the anchor alone would admit it.
    const data = form({
      contactId: ada.id,
      title: "Wedding",
      date: "2022-08-20",
      datePrecision: "DAY",
      location: "The Hideaway",
    });
    data.append("contactIds", secret.id);
    await createLifeEvent(data);

    expect(await listLocations(state.ownerId)).toEqual([]);

    state.unlocked = true;
    expect((await listLocations(state.ownerId)).map((row) => row.name)).toEqual([
      "The Hideaway",
    ]);
  });
});
