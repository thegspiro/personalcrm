import "server-only";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere } from "@/server/privacy/where";
import { privacyScope } from "@/server/privacy/filter";
import { locationVisibleWhere } from "./locations";
import type { Prisma } from "@prisma/client";

/**
 * Rows that could be put on the map but are not.
 *
 * "Unplaced" means both coordinate columns are null. Half a pair cannot occur —
 * every write path stores the pair or nothing — so asking about `latitude`
 * alone is enough, and asking about both is what makes the intent readable.
 *
 * A private contact's addresses are excluded from the query, not filtered after
 * it: their address is never sent to a geocoder whatever the toggle says, which
 * is the same rule `lookupContactAddress` enforces one row at a time. Excluding
 * them here also keeps them out of the counts, so the total never shifts to
 * announce that a hidden person has an address.
 */

export type UnplacedKind = "places" | "addresses";

export interface UnplacedRow {
  id: string;
  /** What to send to the geocoder. Never a person's name. */
  query: string;
  /**
   * The locality this row already claims, so a lone candidate can be checked
   * against it rather than trusted for being alone. Null when it has none.
   */
  city: string | null;
}

/** Cursor-based so a pass always moves forward and never retries a refusal. */
async function addressWhere(ownerId: string, after?: string | null) {
  return {
    contact: { ownerId, isPrivate: false, ...contactPrivacyWhere(await privacyScope()) },
    latitude: null,
    longitude: null,
    ...(after ? { id: { gt: after } } : {}),
  } satisfies Prisma.AddressWhereInput;
}

/**
 * Only places this account can currently see.
 *
 * `ownerId` alone is not enough. A place is reachable only through the
 * interactions and plans that name it, so one known solely through a private
 * interaction is hidden while the lock is closed — and filtering on the owner
 * would have put its name and address in the count, and then sent both to the
 * geocoder. `locationVisibleWhere` is the predicate the places list already
 * uses; spreading it keeps its `AND`, which is why nothing here sets that key.
 */
async function locationWhere(
  ownerId: string,
  after?: string | null,
): Promise<Prisma.LocationWhereInput> {
  return {
    ...locationVisibleWhere(ownerId, await privacyScope()),
    isArchived: false,
    latitude: null,
    longitude: null,
    ...(after ? { id: { gt: after } } : {}),
  };
}

/** How many are left to try, for the progress line. */
export async function countUnplaced(
  ownerId: string,
  kind: UnplacedKind,
  after?: string | null,
): Promise<number> {
  return kind === "addresses"
    ? prisma.address.count({ where: await addressWhere(ownerId, after) })
    : prisma.location.count({ where: await locationWhere(ownerId, after) });
}

/**
 * The next page, in id order.
 *
 * Ordering by id rather than by name keeps the cursor total and stable: a row
 * renamed mid-pass cannot jump behind the cursor and be skipped, or ahead of it
 * and be handled twice.
 */
export async function listUnplaced(
  ownerId: string,
  kind: UnplacedKind,
  take: number,
  after?: string | null,
): Promise<UnplacedRow[]> {
  if (kind === "addresses") {
    const rows = await prisma.address.findMany({
      where: await addressWhere(ownerId, after),
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        line1: true,
        line2: true,
        city: true,
        region: true,
        postalCode: true,
        country: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      // The address itself and nothing else — no label, no notes, and above all
      // not whose address it is.
      city: row.city,
      query: [row.line1, row.line2, row.city, row.region, row.postalCode, row.country]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", "),
    }));
  }

  const rows = await prisma.location.findMany({
    where: await locationWhere(ownerId, after),
    orderBy: { id: "asc" },
    take,
    select: { id: true, name: true, address: true, city: true, region: true, country: true },
  });
  return rows.map((row) => ({
    id: row.id,
    // The name leads: a place is known by what it is called, and the address is
    // often the part that is missing.
    city: row.city,
    query: [row.name, row.address, row.city, row.region, row.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", "),
  }));
}
