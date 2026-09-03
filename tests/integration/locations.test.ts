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

// The actions run through `owner()`, which reads a cookie. Standing in for the
// request context is what lets the real action bodies — including their
// privacy re-checks, which is the point — be exercised here.
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

const {
  getLocation,
  listContactLocations,
  listLocationOptions,
  listLocations,
} = await import("@/server/queries/locations");
const { normalizeLocationName, resolveLocation } =
  await import("@/server/services/locations");
const { buildTimeline } = await import("@/server/queries/timeline");
const { setLocationArchived, updateLocation } =
  await import("@/server/actions/locations");

const TZ = "America/New_York";

/**
 * A place is a second route to an interaction, and so a second way to leak
 * one. These call the location queries themselves rather than rebuilding their
 * where-clauses: the shared predicate is already covered by `privacy.test.ts`,
 * and what is unproven here is that these queries apply it — to the nested
 * reads and to the aggregates the place page displays.
 */
describe.skipIf(!hasTestDatabase)("location history", () => {
  beforeEach(async () => {
    await reset();
    const owner = await createTestUser();
    state.ownerId = owner.id;
    state.enabled = true;
    state.unlocked = false;
  });

  afterAll(() => prisma.$disconnect());

  async function place(ownerId: string, name: string) {
    return prisma.location.create({
      data: { ownerId, name, normalizedName: normalizeLocationName(name) },
    });
  }

  async function visit(
    locationId: string,
    contactIds: string[],
    options: { isPrivate?: boolean; label?: string } = {},
  ) {
    return prisma.interaction.create({
      data: {
        ownerId: state.ownerId,
        occurredAt: new Date(),
        locationId,
        location: options.label ?? "Corner Cafe",
        isPrivate: options.isPrivate ?? false,
        participants: {
          create: contactIds.map((contactId) => ({ contactId })),
        },
      },
    });
  }

  it("withholds private visits and visits with a private participant, counts included", async () => {
    const [ada, grace, secret] = await Promise.all([
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      }),
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Grace" },
      }),
      prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      }),
    ]);
    const cafe = await place(state.ownerId, "Corner Cafe");

    await visit(cafe.id, [ada.id, grace.id], { label: " Corner   Cafe " });
    await visit(cafe.id, [ada.id]);
    // Withheld because it is marked private.
    await visit(cafe.id, [ada.id], { isPrivate: true });
    // Withheld because a private person was there, though it was never marked.
    // Aggregating by place must not be the thing that discloses them.
    await visit(cafe.id, [secret.id]);

    const [listed] = await listLocations(state.ownerId);
    expect(listed.visitCount).toBe(2);
    // A count that shifts on unlock is itself a disclosure, so the aggregates
    // have to be filtered too, not just the rows behind them.
    expect(listed.peopleCount).toBe(2);

    const detail = await getLocation(state.ownerId, cafe.id);
    expect(detail?.interactions).toHaveLength(2);
    const seen = new Set(
      detail?.interactions.flatMap((row) =>
        row.participants.map((p) => p.contact.id),
      ),
    );
    expect(seen).toEqual(new Set([ada.id, grace.id]));
    expect(seen.has(secret.id)).toBe(false);

    // The private contact's own history is withheld by the same route.
    expect(await listContactLocations(state.ownerId, secret.id)).toEqual([]);

    state.unlocked = true;
    const [unlocked] = await listLocations(state.ownerId);
    expect(unlocked.visitCount).toBe(4);
    expect(unlocked.peopleCount).toBe(3);
    expect(
      (await getLocation(state.ownerId, cafe.id))?.interactions,
    ).toHaveLength(4);
    expect(await listContactLocations(state.ownerId, secret.id)).toHaveLength(
      1,
    );
  });

  it("hides a place entirely when every visit to it is withheld", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [secret.id]);

    // Listing the place with a visit count of zero would announce that
    // somewhere was visited by someone who cannot be shown.
    expect(await listLocations(state.ownerId)).toEqual([]);
    expect(await getLocation(state.ownerId, cafe.id)).toBeNull();
  });

  it("keeps the entered label rather than rewriting it to the canonical name", async () => {
    state.unlocked = true;
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [], { label: " Corner   Cafe " });

    const detail = await getLocation(state.ownerId, cafe.id);
    expect(detail?.name).toBe("Corner Cafe");
    expect(detail?.interactions[0]?.location).toBe(" Corner   Cafe ");
  });

  it("does not offer quick add a place known only through a hidden visit", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const hidden = await place(state.ownerId, "Quiet Bar");
    const open = await place(state.ownerId, "Corner Cafe");
    await visit(hidden.id, [secret.id], { label: "Quiet Bar" });
    await visit(open.id, [ada.id]);

    // Which places you have been is itself a disclosure, so the parser is fed
    // the same filtered set the Places directory shows.
    const locked = await listLocationOptions(state.ownerId);
    expect(locked.map((row) => row.name)).toEqual(["Corner Cafe"]);

    state.unlocked = true;
    const unlocked = await listLocationOptions(state.ownerId);
    expect(unlocked.map((row) => row.name).sort()).toEqual([
      "Corner Cafe",
      "Quiet Bar",
    ]);
  });

  it("still resolves a hidden place by name rather than duplicating it", async () => {
    const secret = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
    });
    const hidden = await place(state.ownerId, "Quiet Bar");
    await visit(hidden.id, [secret.id], { label: "Quiet Bar" });

    // Locked, the parser cannot name it back at you — but typing it yourself
    // must still land on the row that exists, not create a second one.
    expect(await listLocationOptions(state.ownerId)).toEqual([]);
    const resolved = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "quiet bar"),
    );
    expect(resolved?.id).toBe(hidden.id);
    expect(
      await prisma.location.count({ where: { ownerId: state.ownerId } }),
    ).toBe(1);
  });

  it("filters the timeline on the place, not just the label that was typed", async () => {
    state.unlocked = true;
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [], { label: "Corner Cafe" });
    // The label is kept exactly as typed while the place collapses whitespace,
    // so a filter that only compared the label dropped this one even though
    // the query had already admitted it on `normalizedName`.
    await visit(cafe.id, [], { label: " Corner   Cafe " });

    const byName = await buildTimeline(state.ownerId, TZ, {
      location: "Corner Cafe",
    });
    expect(byName).toHaveLength(2);

    // Case folding has to agree with the normalizer the rows were written with.
    expect(
      await buildTimeline(state.ownerId, TZ, { location: "corner cafe" }),
    ).toHaveLength(2);

    // The id filter never compares strings at all.
    expect(
      await buildTimeline(state.ownerId, TZ, { locationId: cafe.id }),
    ).toHaveLength(2);
  });

  it("scopes by place id when a freed-up name has been reused", async () => {
    state.unlocked = true;
    const first = await place(state.ownerId, "Corner Cafe");
    await visit(first.id, [], { label: "Corner Cafe" });

    // Rename it, then give a different place the name it just gave up. The
    // first place's historical labels still read "Corner Cafe", because that
    // is what was typed at the time and this branch preserves it.
    await updateLocation(
      (() => {
        const form = new FormData();
        form.set("id", first.id);
        form.set("name", "Old Corner Cafe");
        return form;
      })(),
    );
    const second = await place(state.ownerId, "Corner Cafe");
    await visit(second.id, [], { label: "Corner Cafe" });

    // Filtering by name alone cannot tell them apart, which is why the place
    // page links with the id as well.
    expect(
      await buildTimeline(state.ownerId, TZ, { location: "Corner Cafe" }),
    ).toHaveLength(2);
    const scoped = await buildTimeline(state.ownerId, TZ, {
      locationId: second.id,
      location: "Corner Cafe",
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].placeId).toBe(second.id);
  });

  it("keeps the place filter from admitting entries that have no place", async () => {
    state.unlocked = true;
    const ada = await prisma.contact.create({
      data: { ownerId: state.ownerId, firstName: "Ada" },
    });
    const cafe = await place(state.ownerId, "Corner Cafe");
    await visit(cafe.id, [ada.id]);
    await prisma.gift.create({
      data: {
        ownerId: state.ownerId,
        contactId: ada.id,
        name: "A book",
        status: "GIVEN",
        occurredOn: new Date(),
      },
    });

    // A gift carries no location; filtering by a place must not sweep it in.
    const filtered = await buildTimeline(state.ownerId, TZ, {
      locationId: cafe.id,
    });
    expect(filtered.every((entry) => entry.kind === "interaction")).toBe(true);
    expect(filtered).toHaveLength(1);
  });

  describe("editing a place", () => {
    function formFor(fields: Record<string, string>) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return form;
    }

    it("fills in the practical fields that nothing could reach before", async () => {
      state.unlocked = true;
      const ada = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      });
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, [ada.id]);

      const result = await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          address: "123 Main St",
          city: "Arlington",
          region: "Virginia",
          country: "United States",
          phone: "+1 555 0100",
          url: "https://example.com",
          notes: "Ask for the corner table.",
        }),
      );

      expect(result.ok).toBe(true);
      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.city).toBe("Arlington");
      expect(saved.country).toBe("United States");
      expect(saved.phone).toBe("+1 555 0100");
      expect(saved.notes).toBe("Ask for the corner table.");
    });

    it("renames without rewriting what was typed at the time", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, [], { label: "corner cafe" });

      const result = await updateLocation(
        formFor({ id: cafe.id, name: "The Corner Cafe" }),
      );
      expect(result.ok).toBe(true);

      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.name).toBe("The Corner Cafe");
      expect(saved.normalizedName).toBe("the corner cafe");
      // The history keeps the words that were used at the time.
      const [logged] = await prisma.interaction.findMany({
        where: { ownerId: state.ownerId },
      });
      expect(logged.location).toBe("corner cafe");
    });

    it("keeps a comma inside an alias, and bounds each one to its column", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      // The field asks for one per line and is rendered back that way.
      // Splitting on commas too made "Washington, D.C." two places, one of
      // them named "Washington" — generic enough to catch quick-add text
      // meant for somewhere else entirely.
      const first = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", aliases: "Washington, D.C.\nThe Corner" }),
      );
      expect(first).toMatchObject({ ok: true });
      const saved = await prisma.locationAlias.findMany({
        where: { locationId: cafe.id, isCanonical: false },
        select: { value: true },
        orderBy: { value: "asc" },
      });
      expect(saved.map((alias) => alias.value)).toEqual(["The Corner", "Washington, D.C."]);

      // Each alias is a row in a VARCHAR(191) column, which the 4,000
      // character bound on the whole field says nothing about.
      const result = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", aliases: "x".repeat(192) }),
      );
      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.aliases).toBeTruthy();
    });

    it("refuses a rename onto another place rather than merging them", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      const bar = await place(state.ownerId, "Quiet Bar");
      await visit(cafe.id, []);
      await visit(bar.id, []);

      const result = await updateLocation(
        formFor({ id: bar.id, name: "Corner Cafe" }),
      );

      // Two real venues can share a spelling, and folding one into the other
      // would take a history with it. The user is told, not obeyed.
      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.name).toBeTruthy();
      expect(
        await prisma.location.count({ where: { ownerId: state.ownerId } }),
      ).toBe(2);
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: bar.id } }))
          .name,
      ).toBe("Quiet Bar");
    });

    it("refuses every rename while locked, so a name cannot probe for a hidden place", async () => {
      const secret = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      });
      const ada = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      });
      const hidden = await place(state.ownerId, "Quiet Bar");
      const visible = await place(state.ownerId, "Corner Cafe");
      await visit(hidden.id, [secret.id], { label: "Quiet Bar" });
      await visit(visible.id, [ada.id]);

      // Renaming onto a hidden place's exact name used to answer "you already
      // have a different place with that name", which confirmed it exists —
      // while asking for it directly deliberately says only "not found".
      const onto = await updateLocation(
        formFor({ id: visible.id, name: "Quiet Bar" }),
      );
      // A name nothing is using at all.
      const free = await updateLocation(
        formFor({ id: visible.id, name: "Somewhere New" }),
      );

      // Identical answers: the refusal cannot be used to tell the two apart,
      // which is the whole point. Softer wording would not have helped — the
      // signal was the refusal, not the sentence.
      expect(onto.ok).toBe(false);
      expect(free.ok).toBe(false);
      expect(onto.fieldErrors?.name).toBe(free.fieldErrors?.name);
      expect(onto.fieldErrors?.name).toMatch(/unlock/i);

      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: visible.id } }))
          .name,
      ).toBe("Corner Cafe");
    });

    it("still edits everything except the name while locked", async () => {
      const ada = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      });
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, [ada.id]);

      // Only the name can probe for a hidden place, so only the name is held
      // back. Locking the whole panel would be a tax for no gain.
      const result = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", city: "Arlington" }),
      );

      expect(result.ok).toBe(true);
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } }))
          .city,
      ).toBe("Arlington");
    });

    it("will not edit a place the lock is hiding, and says only 'not found'", async () => {
      const secret = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Secret", isPrivate: true },
      });
      const hidden = await place(state.ownerId, "Quiet Bar");
      await visit(hidden.id, [secret.id]);

      const result = await updateLocation(
        formFor({ id: hidden.id, name: "Renamed" }),
      );

      // Scoping by owner alone would let a locked session edit — or, by the
      // difference between two error messages, confirm the existence of — a
      // place only a hidden interaction knows about.
      expect(result.ok).toBe(false);
      expect(result.error).toBe("That place wasn't found.");
      expect(result.fieldErrors).toBeUndefined();
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: hidden.id } }))
          .name,
      ).toBe("Quiet Bar");
    });

    it("will not edit another account's place", async () => {
      state.unlocked = true;
      const stranger = await createTestUser();
      const theirs = await prisma.location.create({
        data: {
          ownerId: stranger.id,
          name: "Their Cafe",
          normalizedName: normalizeLocationName("Their Cafe"),
        },
      });

      const result = await updateLocation(
        formFor({ id: theirs.id, name: "Mine Now" }),
      );
      expect(result.ok).toBe(false);
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: theirs.id } }))
          .name,
      ).toBe("Their Cafe");
    });

    it("archiving hides a place from the lists but keeps its page and history", async () => {
      state.unlocked = true;
      const ada = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      });
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, [ada.id]);

      expect(
        (await setLocationArchived(formFor({ id: cafe.id, archived: "true" })))
          .ok,
      ).toBe(true);

      expect(await listLocations(state.ownerId)).toEqual([]);
      expect(await listLocationOptions(state.ownerId)).toEqual([]);
      // Nothing is destroyed by a status change: the page still resolves and
      // the visit still points at it.
      const detail = await getLocation(state.ownerId, cafe.id);
      expect(detail?.interactions).toHaveLength(1);

      await setLocationArchived(formFor({ id: cafe.id, archived: "false" }));
      expect(await listLocations(state.ownerId)).toHaveLength(1);
    });

    it("stores the OSM object a lookup matched, and both coordinates or neither", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          osmType: "W",
          osmId: "123456789",
          latitude: "38.8809",
          longitude: "-77.1728",
          city: "Arlington",
        }),
      );

      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.osmType).toBe("W");
      expect(saved.osmId).toBe(123456789n);
      expect(saved.city).toBe("Arlington");
      expect(Number(saved.latitude)).toBeCloseTo(38.8809, 4);
    });

    it("clears the previous OSM object when a later candidate has none", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          osmType: "W",
          osmId: "123456789",
          latitude: "38.8",
          longitude: "-77.1",
        }),
      );
      // A coarser second candidate — a town, say — carries no OSM object.
      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          city: "Arlington",
        }),
      );

      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      // Left as `undefined` these kept their old values, so the map link — which
      // prefers the OSM object — opened the place you had just replaced.
      expect(saved.osmType).toBeNull();
      expect(saved.osmId).toBeNull();
      expect(saved.latitude).toBeNull();
      expect(saved.city).toBe("Arlington");
    });

    it("refuses a provider value too long for its column instead of throwing", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      // These come from an endpoint the app does not control, so an oversized
      // one has to come back as a result rather than a database error.
      const result = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", address: "x".repeat(501) }),
      );

      expect(result.ok).toBe(false);
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } }))
          .address,
      ).toBeNull();
    });

    it("refuses an OSM id that would not fit the column", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      const result = await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          osmType: "N",
          osmId: "99999999999999999999",
        }),
      );
      expect(result.ok).toBe(false);
    });

    it("keeps edits typed before a lookup was accepted", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      // Accepting a candidate used to write on its own and close the panel, so
      // a phone number or note typed first was silently thrown away.
      const result = await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          phone: "+1 555 0100",
          notes: "Ask for the corner table.",
          lookupApplied: "1",
          osmType: "W",
          osmId: "123456789",
          city: "Arlington",
        }),
      );

      expect(result.ok).toBe(true);
      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.phone).toBe("+1 555 0100");
      expect(saved.notes).toBe("Ask for the corner table.");
      expect(saved.osmId).toBe(123456789n);
      expect(saved.city).toBe("Arlington");
    });

    it("leaves a stored OSM object alone on an ordinary save", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);
      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          osmType: "N",
          osmId: "7",
        }),
      );

      // No lookup this time, so identity is not the subject of the save and
      // must survive it.
      await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", phone: "+1 555 0100" }),
      );

      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.osmId).toBe(7n);
      expect(saved.osmType).toBe("N");
      expect(saved.phone).toBe("+1 555 0100");
    });

    it("ignores half a coordinate pair rather than placing it wrongly", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          latitude: "38.8809",
        }),
      );

      const saved = await prisma.location.findUniqueOrThrow({
        where: { id: cafe.id },
      });
      expect(saved.latitude).toBeNull();
      expect(saved.longitude).toBeNull();
    });
  });

  it("resolves the same name to one place per owner, never across owners", async () => {
    const stranger = await createTestUser();

    const mine = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "  Corner   Cafe "),
    );
    const mineAgain = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "corner cafe"),
    );
    const theirs = await prisma.$transaction((tx) =>
      resolveLocation(tx, stranger.id, "Corner Cafe"),
    );

    // Case and repeated whitespace are the same place...
    expect(mineAgain?.id).toBe(mine?.id);
    // ...but the same spelling in another account is not, and resolution must
    // scope by owner rather than trusting the normalized name to be unique.
    expect(theirs?.id).not.toBe(mine?.id);
    expect(
      await prisma.location.count({ where: { ownerId: state.ownerId } }),
    ).toBe(1);
    expect(
      await prisma.location.count({ where: { ownerId: stranger.id } }),
    ).toBe(1);
  });

  it("resolves normalized aliases without crossing owners and rejects competing claims", async () => {
    const stranger = await createTestUser();
    const mine = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Northside Cafe"),
    );
    const theirs = await prisma.$transaction((tx) =>
      resolveLocation(tx, stranger.id, "Other Cafe"),
    );
    await prisma.locationAlias.createMany({
      data: [
        {
          ownerId: state.ownerId,
          locationId: mine!.id,
          value: "The Local",
          normalizedValue: "the local",
        },
        {
          ownerId: stranger.id,
          locationId: theirs!.id,
          value: "The Local",
          normalizedValue: "the local",
        },
      ],
    });
    const resolved = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "  THE   LOCAL "),
    );
    expect(resolved?.id).toBe(mine?.id);
    await expect(
      prisma.locationAlias.create({
        data: {
          ownerId: state.ownerId,
          locationId: mine!.id,
          value: "the local",
          normalizedValue: "the local",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
