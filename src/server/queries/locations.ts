import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { pointOf, withDistance, type Point, type Unit } from "@/lib/geo";
import { applyCap, type CappedList } from "@/lib/list-cap";
import { mapLinkFor } from "@/lib/locations";
import {
  contactPrivacyWhere,
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  privacyScope,
  viaOptionalContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/filter";

/**
 * When a place may be seen at all.
 *
 * A place is only visible through something that happened there, so somewhere
 * known solely through hidden interactions is withheld entirely — listing it
 * with no visits would itself announce that someone you cannot show was there.
 *
 * One definition rather than three copies: the editing action needs exactly
 * this clause, and hand-copied predicates drift.
 *
 * Note the `AND`. `interactionPrivacyWhere` also keys on `participants`, so
 * spreading it beside another filter on the same key silently replaces that
 * filter — the bug that made every place look like one contact's in 6aeaa52.
 *
 * The three clauses go inside the one `AND` member's `OR`, never as a second
 * `AND` member: a place is visible through *any* of the three, and a second
 * member would demand all of them. `lifeEventPrivacyWhere` is `{}` when
 * unlocked, which is why it sits inside `some` — an empty member of an `OR`
 * matches nothing rather than everything, the inversion documented on
 * `viaOptionalContactPrivacyWhere`.
 */
export function locationVisibleWhere(
  ownerId: string,
  scope: PrivacyScope,
): Prisma.LocationWhereInput {
  return {
    ownerId,
    AND: [
      {
        OR: [
          {
            interactions: {
              some: { ownerId, ...interactionPrivacyWhere(scope) },
            },
          },
          {
            plans: {
              some: { ownerId, ...viaOptionalContactPrivacyWhere(scope) },
            },
          },
          {
            lifeEvents: {
              some: { ownerId, ...lifeEventPrivacyWhere(scope) },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Placed places, nearest to a point first.
 *
 * The point of the whole address change: standing on somebody's page, the
 * question is not "what are all my places" but "what is near enough to suggest".
 *
 * Sorted in process rather than by `ST_Distance_Sphere`. Reaching that function
 * means raw SQL, which would lose both Prisma's typing and — the part that
 * matters — the privacy where-fragments this app requires be applied in the
 * query itself rather than after it. One account's places number in the tens,
 * so the trade is not a close one.
 */
export async function listLocationsNear(
  ownerId: string,
  origin: Point | null,
  options: { unit: Unit; take?: number },
) {
  if (!origin) return [];

  const scope = await privacyScope();
  const visible = locationVisibleWhere(ownerId, scope);
  const rows = await prisma.location.findMany({
    where: {
      ...visible,
      isArchived: false,
      // Only placed rows: an unplaced one can never sort anywhere meaningful,
      // and padding the list with "distance unknown" answers a question nobody
      // asked.
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      region: true,
      country: true,
      latitude: true,
      longitude: true,
      osmType: true,
      osmId: true,
    },
  });

  return withDistance(rows, origin, options.unit, pointOf, { sort: true })
    .slice(0, options.take ?? 5)
    .map((row) => ({
      ...row,
      // `Decimal` and `BigInt` do not survive the crossing into a client
      // component, and the map link is built from them.
      mapHref: mapLinkFor(row),
      latitude: row.latitude === null ? null : String(row.latitude),
      longitude: row.longitude === null ? null : String(row.longitude),
      osmId: row.osmId === null ? null : String(row.osmId),
    }));
}

export async function listLocations(ownerId: string, search?: string) {
  const scope = await privacyScope();
  const interactionWhere = { ownerId, ...interactionPrivacyWhere(scope) };
  const visible = locationVisibleWhere(ownerId, scope);
  const rows = await prisma.location.findMany({
    where: {
      ...visible,
      isArchived: false,
      AND: [
        ...(visible.AND as Prisma.LocationWhereInput[]),
        ...(search?.trim()
          ? [
              {
                OR: [
                  { name: { contains: search.trim() } },
                  { address: { contains: search.trim() } },
                  {
                    locationAliases: {
                      some: { ownerId, value: { contains: search.trim() } },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    include: {
      interactions: {
        where: interactionWhere,
        select: {
          occurredAt: true,
          sentiment: true,
          participants: { select: { contactId: true } },
        },
        orderBy: { occurredAt: "desc" },
      },
      plans: {
        where: { ownerId, ...viaOptionalContactPrivacyWhere(scope) },
        select: { id: true, status: true },
      },
      // Counted so a place reached only through a life event does not read
      // "0 visits · 0 people" — it has a reason to exist, and the card should
      // say what it is.
      lifeEvents: {
        where: { ownerId, ...lifeEventPrivacyWhere(scope) },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    ...row,
    lifeEventCount: row.lifeEvents.length,
    visitCount: row.interactions.length,
    peopleCount: new Set(
      row.interactions.flatMap((item) =>
        item.participants.map((p) => p.contactId),
      ),
    ).size,
    lastVisitedAt: row.interactions[0]?.occurredAt ?? null,
    averageSentiment: average(
      row.interactions.flatMap((item) => item.sentiment ?? []),
    ),
    openPlanCount: row.plans.filter(
      (plan) => plan.status === "OPEN" || plan.status === "PLANNED",
    ).length,
  }));
}

/**
 * A lightweight list of places, for the quick-add parser.
 *
 * Privacy-filtered with the same predicate the Places directory uses: the set
 * of places you have been is itself a disclosure, so somewhere known only
 * through hidden interactions is not offered back while the lock is closed.
 *
 * The two halves are combined with `AND` rather than spread into one object.
 * `interactionPrivacyWhere` also keys on `participants`, so a spread silently
 * replaces a sibling filter — the bug fixed in `listContactLocations`.
 */
export async function listLocationOptions(ownerId: string) {
  const scope = await privacyScope();
  return prisma.location.findMany({
    where: { ...locationVisibleWhere(ownerId, scope), isArchived: false },
    select: {
      id: true,
      name: true,
      // Owner-filtered like every other read of this relation: the alias's
      // ownerId and its location's are two independent columns, so an import
      // or a restore can leave one account's alias hanging off another
      // account's place, and an unfiltered include hands its value straight to
      // quick-add matching.
      locationAliases: { where: { ownerId }, select: { value: true } },
    },
    // By name, not by recency: a "most recently visited" order derived from
    // unfiltered visits is a signal that shifts when the lock opens.
    //
    // Uncapped on purpose. A cap here is not a page, it is a silent hole in the
    // parser's vocabulary: past it, a known venue simply stops being recognised
    // and can have part of its name offered as a person instead. Two columns
    // for the places one person has actually been is a small read.
    orderBy: { name: "asc" },
  });
}

/** How many places a picker offers before it admits it is not showing them all. */
export const PLACE_SUGGESTIONS_CAP = 200;

export interface PlaceSuggestion {
  id: string;
  name: string;
  /** "visited 4 times · last May 2026", or null somewhere only ever planned. */
  subtitle: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  osmType: string | null;
  osmId: string | null;
}

/**
 * What a place says under its own name in a picker.
 *
 * Formatted here rather than in the component, for two reasons: a `Date` does
 * not survive the crossing into a client component, and the browser's zone is
 * not the one the rest of this app counts days in.
 */
function visitSubtitle(
  visits: number,
  lastVisitedAt: Date | null,
  timezone: string,
): string | null {
  if (visits === 0) return null;
  const counted = visits === 1 ? "visited once" : `visited ${visits} times`;
  if (!lastVisitedAt) return counted;
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(lastVisitedAt);
  return `${counted} · last ${month}`;
}

/**
 * The places you already have, for the picker beside every "Where" box.
 *
 * A sibling of `listLocationOptions` rather than an extension of it, and the
 * two must stay apart. That one is the quick-add parser's vocabulary and is
 * uncapped for the reason written above it; this one feeds a list a human
 * reads, so it caps, and it carries visit counts the parser has no use for.
 * Folding them together would put a cap on the parser and a hole in what it
 * recognises.
 *
 * Ordered by name, never by recency. A privacy-filtered `visitCount` is safe
 * to show — the Places directory already renders that same number off this
 * same filtered relation — but ordering by the last visit is not: a row whose
 * *position* moves when the lock opens is itself the disclosure. Sorting in
 * process would not dodge that, it would reintroduce it one layer up.
 *
 * Capping is safe here where it is not in `listLocationOptions`, because the
 * free-text box stays live: a place past the cap is still typeable and still
 * resolves to the same row through `resolveLocation`.
 */
export async function listPlaceSuggestions(
  ownerId: string,
  timezone: string,
): Promise<CappedList<PlaceSuggestion>> {
  const scope = await privacyScope();
  const visibleInteraction = { ownerId, ...interactionPrivacyWhere(scope) };
  const rows = await prisma.location.findMany({
    where: { ...locationVisibleWhere(ownerId, scope), isArchived: false },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      region: true,
      country: true,
      latitude: true,
      longitude: true,
      osmType: true,
      osmId: true,
      // The count and the newest visit, not the visits themselves: a place with
      // three hundred interactions would otherwise ship all of them to render
      // one line of text.
      _count: { select: { interactions: { where: visibleInteraction } } },
      interactions: {
        where: visibleInteraction,
        select: { occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: PLACE_SUGGESTIONS_CAP + 1,
  });

  const capped = applyCap(rows, PLACE_SUGGESTIONS_CAP);
  return {
    truncated: capped.truncated,
    items: capped.items.map((row) => ({
      id: row.id,
      name: row.name,
      subtitle: visitSubtitle(
        row._count.interactions,
        row.interactions[0]?.occurredAt ?? null,
        timezone,
      ),
      address: row.address,
      city: row.city,
      region: row.region,
      country: row.country,
      // `Decimal` and `BigInt` do not survive the crossing into a client
      // component, and the address form fills its coordinates from these.
      latitude: row.latitude === null ? null : String(row.latitude),
      longitude: row.longitude === null ? null : String(row.longitude),
      osmType: row.osmType,
      osmId: row.osmId === null ? null : String(row.osmId),
    })),
  };
}

/** How many distinct values a locality datalist offers. */
const LOCALITY_SUGGESTIONS_CAP = 100;

export interface LocalitySuggestions {
  cities: string[];
  regions: string[];
  countries: string[];
}

/** Case-insensitive dedupe keeping the first spelling seen, then sorted. */
function distinct(values: ReadonlyArray<string | null>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("en-US");
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, LOCALITY_SUGGESTIONS_CAP);
}

/**
 * Cities, states and countries this account has already written down.
 *
 * Suggestions for the free-text locality boxes, which have no identity to pick
 * — there is no row behind "Arlington", only the same word typed again. So
 * these feed a `<datalist>` rather than a picker, the way the address label
 * field already offers its four.
 *
 * Two sources, each with its own predicate, because they are reached two
 * different ways: a place through the interactions and plans that name it, an
 * address through the contact it hangs off. Two small correct queries rather
 * than one clever one.
 *
 * A city is less identifying than a venue, but one that appears *only* because
 * of a hidden interaction is still a disclosure — the same reason the places
 * list is filtered — so the predicate is not optional here either.
 *
 * Capping is safe: the box stays free text, so a value past the cap is still
 * typeable and still saves.
 */
export async function listLocalitySuggestions(
  ownerId: string,
): Promise<LocalitySuggestions> {
  const scope = await privacyScope();
  const [places, addresses] = await Promise.all([
    prisma.location.findMany({
      where: { ...locationVisibleWhere(ownerId, scope), isArchived: false },
      select: { city: true, region: true, country: true },
    }),
    prisma.address.findMany({
      where: { contact: { ownerId, ...contactPrivacyWhere(scope) } },
      select: { city: true, region: true, country: true },
    }),
  ]);

  const rows = [...places, ...addresses];
  return {
    cities: distinct(rows.map((row) => row.city)),
    regions: distinct(rows.map((row) => row.region)),
    countries: distinct(rows.map((row) => row.country)),
  };
}

export async function getLocation(ownerId: string, id: string) {
  const scope = await privacyScope();
  const visibleInteraction = { ownerId, ...interactionPrivacyWhere(scope) };
  const visiblePlan = { ownerId, ...viaOptionalContactPrivacyWhere(scope) };
  const visibleLifeEvent = { ownerId, ...lifeEventPrivacyWhere(scope) };
  return prisma.location.findFirst({
    // Deliberately not filtered on `isArchived`: an archived place keeps its
    // page and its history, it just leaves the directory.
    //
    // This `OR` hand-copies `locationVisibleWhere`'s, because the include below
    // needs the same three predicates by name. Both must gain a clause
    // together, or a place known only through a life event 404s from its own
    // page while the directory happily links to it.
    where: {
      id,
      ownerId,
      OR: [
        { interactions: { some: visibleInteraction } },
        { plans: { some: visiblePlan } },
        { lifeEvents: { some: visibleLifeEvent } },
      ],
    },
    include: {
      interactions: {
        where: visibleInteraction,
        include: {
          type: true,
          participants: {
            include: {
              contact: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { occurredAt: "desc" },
      },
      locationAliases: { where: { ownerId }, orderBy: { value: "asc" } },
      plans: {
        where: visiblePlan,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function listContactLocations(ownerId: string, contactId: string) {
  const scope = await privacyScope();
  // Both halves key on `participants` -- "this person was there" and "nobody
  // private was there" -- so spreading the privacy fragment into the same
  // object literal silently dropped the contact filter, and every place the
  // account had visited came back as this person's. AND keeps both.
  const theirs = {
    ownerId,
    AND: [
      { participants: { some: { contactId } } },
      interactionPrivacyWhere(scope),
    ],
  };
  const rows = await prisma.location.findMany({
    where: { ownerId, interactions: { some: theirs } },
    include: {
      interactions: {
        where: theirs,
        select: { occurredAt: true },
        orderBy: { occurredAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    visits: row.interactions.length,
    lastVisitedAt: row.interactions[0]?.occurredAt ?? null,
  }));
}

function average(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}
