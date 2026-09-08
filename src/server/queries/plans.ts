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
      ...(options.includeDone ? {} : { status: { in: ["OPEN", "PLANNED"] } }),
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

  // Annotated in process — see the note on `listLocationsNear` for why this is
  // not `ST_Distance_Sphere`. Status still leads the ordering when sorting by
  // distance is not asked for, because OPEN before ARCHIVED is what a list of
  // plans wants first.
  const measured = withDistance(
    rows,
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
