import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { privacyScope } from "@/server/privacy/filter";
import { mapLinkFor } from "@/lib/locations";
import { pointOf, withDistance, type Point, type Unit } from "@/lib/geo";

/**
 * Reads for saved plans — the things you mean to do with people.
 *
 * Not a dating query, which is why it does not live in `dating.ts`: the same
 * rows hold a hike with a friend, a first date, and the ones saved against
 * nobody at all.
 */

/**
 * Plans, newest first within each status.
 *
 * `contactId` narrows to one person *plus* the ones saved against nobody,
 * because "go to the observatory" is worth offering whoever you are looking
 * at. `romanticOnly` is the dating page's view of the same list.
 *
 * Status leads the ordering: an enum column sorts by its declaration order,
 * which is OPEN, PLANNED, DONE, ARCHIVED — exactly the order a list of plans
 * wants.
 */
export async function listPlans(
  ownerId: string,
  options: {
    contactId?: string;
    romanticOnly?: boolean;
    includeDone?: boolean;
    /**
     * Only the closed ones — the view that looks back at what was done.
     *
     * A separate view rather than `includeDone`'s wider list, because the cap
     * makes "wider" a lie: statuses sort OPEN, PLANNED, DONE, ARCHIVED, so an
     * account with 200 open plans fills the whole page before a single closed
     * one is reached, and the history it was asked for is exactly what falls
     * off the end. Filtering to closed rows is what makes them reachable at
     * all. Takes precedence over `includeDone`.
     */
    closedOnly?: boolean;
    /** Row cap. Callers that want to detect truncation ask for one more. */
    take?: number;
    /**
     * Measure each plan's place from here. Without it every plan comes back
     * with `distance: null` and the lists read exactly as they did before.
     */
    origin?: Point | null;
    unit?: Unit;
    /** Nearest first, with the unplaced ones behind in their existing order. */
    sortByDistance?: boolean;
  } = {},
) {
  const scope = await privacyScope();

  // Every clause is a separate OR, so they are ANDed explicitly rather than
  // spread into one object — a second `OR` key would silently replace the first.
  const clauses: Prisma.PlanWhereInput[] = [];

  if (options.contactId) {
    clauses.push({ OR: [{ contactId: options.contactId }, { contactId: null }] });
  }
  if (options.romanticOnly) {
    clauses.push({ OR: [{ contactId: null }, { contact: { isRomantic: true } }] });
  }
  // A plan carries no privacy marker of its own; it inherits the one belonging
  // to the person it names, the way a gift does. Saved against nobody, there is
  // no one to be private, so it always shows.
  if (!scope.unlocked) {
    clauses.push({ OR: [{ contactId: null }, { contact: { isPrivate: false } }] });
  }

  const rows = await prisma.plan.findMany({
    where: {
      ownerId,
      ...(clauses.length > 0 ? { AND: clauses } : {}),
      ...(options.closedOnly
        ? { status: { in: ["DONE", "ARCHIVED"] } }
        : options.includeDone
          ? {}
          : { status: { in: ["OPEN", "PLANNED"] } }),
    },
    include: {
      category: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
      // Where the plan actually is. A plan's own `location` is the words that
      // were typed; the place is the thing that has coordinates. Everything
      // `mapLinkFor` reads is selected, not just the coordinates: the link
      // prefers the OSM object, and falls back to a search built from the
      // address and locality when there are no coordinates at all.
      place: {
        select: {
          id: true,
          // Not for display. `Plan.place` is keyed on the target id alone —
          // `SET NULL` needs every column of the key nullable and `ownerId` is
          // not — so a restored or imported plan can point at another account's
          // `Location`, which is why `ownedPlanRefs` exists on the write side.
          ownerId: true,
          name: true,
          address: true,
          city: true,
          region: true,
          country: true,
          osmType: true,
          osmId: true,
          latitude: true,
          longitude: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: options.take ?? 200,
  });

  // A place belonging to someone else is dropped before anything is derived
  // from it. The relation cannot carry an owner predicate — Prisma has no
  // `where` on a to-one include — so the check is here, and it has to come
  // first: the name, the map link and the distance are each built from these
  // columns, so filtering afterwards would mean deciding what to disclose after
  // already computing it. The plan keeps its typed `location` text either way;
  // what is dropped is a pointer that should never have been stored.
  const owned = rows.map(({ place, ...plan }) => ({
    ...plan,
    place: place && place.ownerId === ownerId ? place : null,
  }));

  // Annotated in process — see the note on `listLocationsNear` for why this is
  // not `ST_Distance_Sphere`. Status still leads the ordering when sorting by
  // distance is not asked for, because OPEN before ARCHIVED is what a list of
  // plans wants first.
  const measured = withDistance(
    owned,
    options.origin,
    options.unit ?? "mi",
    (plan) => pointOf(plan.place),
    { sort: options.sortByDistance },
  );

  // The link is resolved here rather than in the pages, the way
  // `listLocationsNear` already resolves it: `mapLinkFor` prefers the OSM
  // object, and `Location.osmId` is a `BigInt` — passed to a client component it
  // throws on serialisation rather than failing a typecheck, so it must not
  // survive this function. The coordinates do survive, because the person page
  // measures these same rows a second time from the contact rather than from
  // home; they are dropped where each page builds its `PlanItem`.
  return measured.map(({ place, ...plan }) => ({
    ...plan,
    place: place
      ? {
          id: place.id,
          name: place.name,
          mapHref: mapLinkFor(place),
          latitude: place.latitude,
          longitude: place.longitude,
        }
      : null,
  }));
}
