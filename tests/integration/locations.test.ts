import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  asARestoreWould,
  createTestUser,
  hasTestDatabase,
  holdUncommitted,
  prisma,
  releaseAfterItBlocks,
  reset,
} from "./db";

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

  it("does not render or search a place belonging to another account", async () => {
    state.unlocked = true;
    const stranger = await createTestUser();
    const theirs = await prisma.location.create({
      data: {
        ownerId: stranger.id,
        name: "Their Secret Bar",
        normalizedName: normalizeLocationName("Their Secret Bar"),
      },
    });
    // `Interaction.place` is the one reference that keeps a single-column key:
    // it clears on delete, and MariaDB will not accept a SET NULL composite
    // key while `ownerId` is NOT NULL. So this row is writable, and the
    // reader's own predicate is the whole defence.
    await visit(theirs.id, [], { label: "somewhere" });

    const entries = await buildTimeline(state.ownerId, TZ, {});
    expect(entries).toHaveLength(1);
    expect(entries[0].placeId).toBeNull();
    expect(entries[0].placeName).toBeNull();

    // Neither route into the query may match on it: free-text search over the
    // place name, nor the normalized-name filter the place page links with.
    expect(
      await buildTimeline(state.ownerId, TZ, { search: "Secret Bar" }),
    ).toHaveLength(0);
    expect(
      await buildTimeline(state.ownerId, TZ, { location: "Their Secret Bar" }),
    ).toHaveLength(0);
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

    it("folds two aliases the index will call one, rather than dying on the key", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      // normalizeLocationName keeps accents; the unique index is
      // utf8mb4_unicode_ci and does not. Both spellings therefore reached
      // createMany as separate rows and one key, and a constraint error rolled
      // back an otherwise ordinary edit with nothing shown on the form.
      const result = await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          aliases: "Cafe Central\nCaf\u00e9 Central\nThe Corner",
        }),
      );

      expect(result).toMatchObject({ ok: true });
      const saved = await prisma.locationAlias.findMany({
        where: { locationId: cafe.id, isCanonical: false },
        select: { value: true },
        orderBy: { value: "asc" },
      });
      // One row for the pair, keeping the spelling that was typed first.
      expect(saved.map((alias) => alias.value)).toEqual([
        "Cafe Central",
        "The Corner",
      ]);

      // And an alias the index will call the same as the canonical name is
      // dropped rather than written beside it.
      const accented = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", aliases: "Corner Caf\u00e9" }),
      );
      expect(accented).toMatchObject({ ok: true });
      expect(
        await prisma.locationAlias.count({
          where: { locationId: cafe.id, isCanonical: false },
        }),
      ).toBe(0);
    });

    it("refuses an alias that is another place's canonical name, claim row or not", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      const bar = await place(state.ownerId, "Quiet Bar");
      await visit(cafe.id, []);
      await visit(bar.id, []);
      // The bar has no canonical alias row — an import, a half-applied fix, a
      // process straddling the upgrade. The alias table is derived from
      // Location rather than authoritative over it, so asking only the alias
      // table saw no conflict and let the cafe claim "Quiet Bar" as an alias.
      // resolveLocation consults aliases first, so every later mention of the
      // bar's own name would have been filed against the cafe.
      expect(
        await prisma.locationAlias.count({ where: { locationId: bar.id } }),
      ).toBe(0);

      const result = await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", aliases: "Quiet Bar" }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.aliases).toBeTruthy();
      expect(
        await prisma.locationAlias.count({
          where: { ownerId: state.ownerId, normalizedValue: "quiet bar" },
        }),
      ).toBe(0);

      // The bar's own name still resolves to the bar.
      const resolved = await prisma.$transaction((tx) =>
        resolveLocation(tx, state.ownerId, "Quiet Bar"),
      );
      expect(resolved?.id).toBe(bar.id);
    });

    it("cannot store an alias that belongs to another account", async () => {
      // This used to check the readers: two independent foreign keys let an
      // import or a restore leave a stranger's alias hanging off our place, and
      // an unfiltered include handed its value to quick-add matching and
      // rendered it into the editor. The alias now references
      // `Location(ownerId, id)`, so the row itself is refused and the property
      // holds for every reader at once rather than for the ones that remembered.
      state.unlocked = true;
      const stranger = await createTestUser();
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      const foreign = {
        ownerId: stranger.id,
        locationId: cafe.id,
        value: "Their Private Name",
        normalizedValue: "their private name",
        isCanonical: false,
      };
      await expect(
        prisma.locationAlias.create({ data: foreign }),
      ).rejects.toMatchObject({ code: "P2003" });

      // A restore can still bring one in, so the readers' own predicates still
      // have to hold: an unfiltered include handed this value to quick-add
      // matching and rendered it into the editor.
      await asARestoreWould((tx) => tx.locationAlias.create({ data: foreign }));

      const options = await listLocationOptions(state.ownerId);
      const mine = options.find((option) => option.id === cafe.id);
      expect(mine?.locationAliases.map((alias) => alias.value) ?? []).not.toContain(
        "Their Private Name",
      );

      const page = await getLocation(state.ownerId, cafe.id);
      expect(
        (page?.locationAliases ?? []).map((alias) => alias.value),
      ).not.toContain("Their Private Name");
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

    it("refuses every alias change while locked, so an alias cannot probe either", async () => {
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
      await prisma.locationAlias.create({
        data: {
          ownerId: state.ownerId,
          locationId: hidden.id,
          value: "The Snug",
          normalizedValue: normalizeLocationName("The Snug"),
          isCanonical: false,
        },
      });

      // Leaving the canonical name alone walked straight past the rename
      // guard, and the alias collision check then answered the very same
      // question of the whole account, hidden places included: a guessed
      // hidden name came back as a collision while a free one saved.
      const onto = await updateLocation(
        formFor({ id: visible.id, name: "Corner Cafe", aliases: "The Snug" }),
      );
      const free = await updateLocation(
        formFor({ id: visible.id, name: "Corner Cafe", aliases: "Somewhere New" }),
      );

      expect(onto.ok).toBe(false);
      expect(free.ok).toBe(false);
      expect(onto.fieldErrors?.aliases).toBe(free.fieldErrors?.aliases);
      expect(onto.fieldErrors?.aliases).toMatch(/unlock/i);
      expect(
        await prisma.locationAlias.count({
          where: { locationId: visible.id, isCanonical: false },
        }),
      ).toBe(0);

      // Unlocked, the collision is a real answer to a real question again.
      state.unlocked = true;
      const taken = await updateLocation(
        formFor({ id: visible.id, name: "Corner Cafe", aliases: "The Snug" }),
      );
      expect(taken.ok).toBe(false);
      expect(taken.fieldErrors?.aliases).toMatch(/already uses/i);
      expect(
        (await updateLocation(
          formFor({ id: visible.id, name: "Corner Cafe", aliases: "Somewhere New" }),
        )).ok,
      ).toBe(true);
    });

    it("saves the rest of the panel while locked when the aliases are unchanged", async () => {
      const ada = await prisma.contact.create({
        data: { ownerId: state.ownerId, firstName: "Ada" },
      });
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, [ada.id]);
      await prisma.locationAlias.create({
        data: {
          ownerId: state.ownerId,
          locationId: cafe.id,
          value: "The Corner",
          normalizedValue: normalizeLocationName("The Corner"),
          isCanonical: false,
        },
      });

      // The form resubmits the aliases it was rendered with on every save, so
      // only a *change* may be refused — otherwise correcting a phone number
      // while locked would fail for no reason the user could see.
      const result = await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          aliases: "The Corner",
          city: "Arlington",
        }),
      );

      expect(result).toMatchObject({ ok: true });
      expect(
        (await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } })).city,
      ).toBe("Arlington");
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

    it("places a venue by hand, since lookup is off in the shipped state", async () => {
      // Without this there is no way to give a place coordinates at all unless
      // the optional lookup is switched on — and every distance in the app
      // would be unreachable for anyone who never turns it on.
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);

      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          latitude: "53.8008",
          longitude: "-1.5491",
        }),
      );

      const saved = await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } });
      expect(Number(saved.latitude)).toBeCloseTo(53.8008, 4);
      expect(Number(saved.longitude)).toBeCloseTo(-1.5491, 4);
    });

    it("drops an OSM reference once the coordinates it came with are gone", async () => {
      state.unlocked = true;
      const cafe = await place(state.ownerId, "Corner Cafe");
      await visit(cafe.id, []);
      await updateLocation(
        formFor({
          id: cafe.id,
          name: "Corner Cafe",
          lookupApplied: "1",
          latitude: "38.8809",
          longitude: "-77.0355",
          osmType: "N",
          osmId: "7",
        }),
      );

      // Clearing the coordinates by hand must take the reference with them:
      // `mapLinkFor` prefers it, so a reference left behind would go on opening
      // the venue this place used to be.
      await updateLocation(
        formFor({ id: cafe.id, name: "Corner Cafe", latitude: "", longitude: "" }),
      );

      const saved = await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } });
      expect(saved.latitude).toBeNull();
      expect(saved.osmType).toBeNull();
      expect(saved.osmId).toBeNull();
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

  it("keeps a correction made while a date save was deciding what to fill in", async () => {
    // The fill-only rule is a read followed by a write, and a snapshot read sees
    // nothing of a correction committing in between. Held uncommitted, the
    // correction's row lock is real: `resolveLocation` must wait for it rather
    // than deciding from a value that has already been replaced.
    const first = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe"),
    );

    const held = await holdUncommitted((tx) =>
      tx.location.update({ where: { id: first!.id }, data: { city: "Wetherby" } }),
    );

    const saving = prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe", { city: "Leeds" }),
    );
    await releaseAfterItBlocks(held.release);
    await Promise.all([held.settled, saving]);

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: first!.id } });
    expect(saved.city).toBe("Wetherby");
  });

  it("keeps coordinates set while a date save was deciding whether to place it", async () => {
    // The same race, on the half that shipped earlier: a place geocoded
    // deliberately must not be moved by a save that read it as unplaced.
    const first = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe"),
    );

    const held = await holdUncommitted((tx) =>
      tx.location.update({
        where: { id: first!.id },
        data: { latitude: 53.8008, longitude: -1.5491 },
      }),
    );

    const saving = prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe", {
        latitude: "48.8566",
        longitude: "2.3522",
      }),
    );
    await releaseAfterItBlocks(held.release);
    await Promise.all([held.settled, saving]);

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: first!.id } });
    expect(Number(saved.latitude)).toBeCloseTo(53.8008, 4);
  });

  it("survives a correction that committed before the save reached the place", async () => {
    // The other order, and the one CI caught: the correction commits *before*
    // resolveLocation gets to the row rather than while it waits. A locking read
    // here raises MariaDB 1020 — "Record has changed since last read" — because
    // the transaction has already taken snapshot reads to find this place, and
    // the whole save dies. Deciding in the WHERE has nothing to go stale.
    const first = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe"),
    );

    const saving = prisma.$transaction(async (tx) => {
      // Force the snapshot, the way the real resolution reads do.
      await tx.location.findFirst({ where: { ownerId: state.ownerId } });
      await prisma.location.update({
        where: { id: first!.id },
        data: { city: "Wetherby" },
      });
      return resolveLocation(tx, state.ownerId, "Corner Cafe", { city: "Leeds" });
    });

    await expect(saving).resolves.toBeTruthy();
    const saved = await prisma.location.findUniqueOrThrow({ where: { id: first!.id } });
    expect(saved.city).toBe("Wetherby");
  });

  it("carries a lookup's locality and coordinates onto a place it creates", async () => {
    // Before this, `resolveLocation` took only an address and a URL, so an
    // accepted candidate flowing through a plan or a date save had its city and
    // its coordinates dropped on the floor — and the place could never be
    // measured from anywhere.
    const created = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Northside Cafe", {
        address: "12 Vicar Lane",
        city: "Leeds",
        region: "West Yorkshire",
        country: "United Kingdom",
        latitude: "53.7997",
        longitude: "-1.5492",
        osmType: "N",
        osmId: "987654321098",
      }),
    );

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: created!.id } });
    expect(saved.city).toBe("Leeds");
    expect(saved.region).toBe("West Yorkshire");
    expect(saved.country).toBe("United Kingdom");
    expect(Number(saved.latitude)).toBeCloseTo(53.7997, 4);
    expect(saved.osmType).toBe("N");
    expect(saved.osmId).toBe(987654321098n);
  });

  it("fills coordinates in but never moves a place that already has them", async () => {
    const first = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe", {
        latitude: "53.7997",
        longitude: "-1.5492",
      }),
    );

    // Typing the venue's name into an interaction is evidence of *which* place
    // is meant, not of where it is. Overwriting here would let a stray save
    // move a place the user had geocoded deliberately on its own page.
    await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "corner cafe", {
        latitude: "48.8566",
        longitude: "2.3522",
        city: "Paris",
      }),
    );

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: first!.id } });
    expect(Number(saved.latitude)).toBeCloseTo(53.7997, 4);
    // Text still overwrites when it is given, exactly as it always has.
    expect(saved.city).toBe("Paris");
  });

  it("refuses half a coordinate pair rather than placing a prime-meridian guess", async () => {
    const created = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Half Cafe", { latitude: "53.7997" }),
    );
    const saved = await prisma.location.findUniqueOrThrow({ where: { id: created!.id } });
    expect(saved.latitude).toBeNull();
    expect(saved.longitude).toBeNull();
  });

  it("leaves a place exactly as it was for the callers that pass no details", async () => {
    // The backward-compatibility guarantee: six call sites pass nothing beyond
    // a name, and widening the parameter must not have changed any of them.
    const created = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Plain Cafe", {
        address: "12 Vicar Lane",
        city: "Leeds",
        latitude: "53.7997",
        longitude: "-1.5492",
      }),
    );

    const again = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Plain Cafe"),
    );
    expect(again?.id).toBe(created?.id);

    const saved = await prisma.location.findUniqueOrThrow({ where: { id: created!.id } });
    expect(saved.address).toBe("12 Vicar Lane");
    expect(saved.city).toBe("Leeds");
    expect(Number(saved.latitude)).toBeCloseTo(53.7997, 4);
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

  it("prefers a place's own name over another place's alias for it", async () => {
    // Reachable from an import, a restore, a hand repair, or an upgrade caught
    // mid-deployment: the canonical claim for one place is missing while
    // another place carries an alias spelt the same. The action-side checks
    // stop it being created through the UI; they cannot stop it arriving.
    const cafe = await prisma.location.create({
      data: {
        ownerId: state.ownerId,
        name: "Corner Cafe",
        normalizedName: normalizeLocationName("Corner Cafe"),
      },
    });
    const bar = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Quiet Bar"),
    );
    await prisma.locationAlias.create({
      data: {
        ownerId: state.ownerId,
        locationId: bar!.id,
        value: "Corner Cafe",
        normalizedValue: normalizeLocationName("Corner Cafe"),
      },
    });

    const resolved = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "Corner Cafe", {
        address: "12 Corner Street",
      }),
    );

    // Asking the alias index first filed every mention of the cafe's real name
    // against the bar, and wrote the cafe's address onto the bar with it.
    expect(resolved?.id).toBe(cafe.id);
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: bar!.id } }))
        .address,
    ).toBeNull();
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: cafe.id } }))
        .address,
    ).toBe("12 Corner Street");
    // And the conflicting claim is re-pointed rather than left to mislead the
    // next lookup in the same way.
    const claim = await prisma.locationAlias.findUniqueOrThrow({
      where: {
        ownerId_normalizedValue: {
          ownerId: state.ownerId,
          normalizedValue: normalizeLocationName("Corner Cafe"),
        },
      },
    });
    expect(claim.locationId).toBe(cafe.id);
    expect(claim.isCanonical).toBe(true);
  });

  it("will not hand back a location the alias points at across accounts", async () => {
    const stranger = await createTestUser();
    const theirs = await prisma.location.create({
      data: {
        ownerId: stranger.id,
        name: "Their Cafe",
        normalizedName: normalizeLocationName("Their Cafe"),
      },
    });
    // The alias now references `Location(ownerId, id)`, so the application
    // cannot make this row — but a restore can, because a dump disables
    // foreign-key checks. That is the case this guard is left in for.
    await asARestoreWould((tx) =>
      tx.locationAlias.create({
        data: {
          ownerId: state.ownerId,
          locationId: theirs.id,
          value: "The Local",
          normalizedValue: "the local",
        },
      }),
    );

    const resolved = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "The Local", {
        address: "1 Main St",
        url: "https://example.test",
      }),
    );

    // Accepting the alias on its own ownerId returned the stranger's place —
    // and this call would then have written our address and URL onto it, and
    // every interaction logged here would have hung off their row.
    expect(resolved?.id).not.toBe(theirs.id);
    expect(
      await prisma.location.findUniqueOrThrow({ where: { id: resolved!.id } }),
    ).toMatchObject({ ownerId: state.ownerId });
    expect(
      await prisma.location.findUniqueOrThrow({ where: { id: theirs.id } }),
    ).toMatchObject({ address: null, url: null });

    // The stale row is re-pointed rather than left beside a second claim on
    // the same key — the unique index refuses that, and the constraint error
    // would have come out of the save with nothing to show the user.
    const claims = await prisma.locationAlias.findMany({
      where: { ownerId: state.ownerId, normalizedValue: "the local" },
      select: { locationId: true, isCanonical: true },
    });
    expect(claims).toEqual([
      { locationId: resolved!.id, isCanonical: true },
    ]);

    // And the repaired place resolves by name from then on.
    const again = await prisma.$transaction((tx) =>
      resolveLocation(tx, state.ownerId, "the local"),
    );
    expect(again?.id).toBe(resolved!.id);
  });
});
