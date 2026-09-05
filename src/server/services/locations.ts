import type { Prisma } from "@prisma/client";
import { normalizeLocationName } from "@/lib/locations";
import { pointOf } from "@/lib/geo";

// The normalizer lives in `src/lib/` so the pure quick-add parser and the
// timeline post-filter can share it. Re-exported here because this module is
// where every write path already looks for it.
export { normalizeLocationName };

/**
 * What a caller knows about the place beyond its name.
 *
 * Every field optional, so the callers that pass nothing — and the ones that
 * pass only an address and a URL, which is all this took before — behave
 * exactly as they did. The locality and coordinate fields exist so an accepted
 * lookup candidate flowing through a plan or a date save lands on the place
 * instead of being dropped, which is what used to happen.
 */
export interface LocationDetails {
  address?: string | null;
  url?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  osmType?: string | null;
  osmId?: string | bigint | null;
}

/**
 * The text a caller supplied, minus the blanks.
 *
 * Only truthy values are written, which is the rule this function has always
 * followed: a save that happens not to carry a city must not wipe the one typed
 * on the place page.
 */
function textUpdates(details: LocationDetails): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of ["address", "url"] as const) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) updates[key] = value.trim();
  }
  return updates;
}

/**
 * Where the place is, filled in but never rewritten.
 *
 * The locality is shared by every interaction and plan that names this place,
 * while what a caller passes is the wording from one of them — often an old one.
 * Editing a date's rating resubmits the city typed at the time, and overwriting
 * on that would undo a correction made on the place's own page, or leave a venue
 * holding coordinates for one city and text naming another, for everybody.
 *
 * So this behaves like the coordinates below: it completes a place that is
 * missing something, and otherwise leaves it alone. `address` and `url` keep
 * their older overwrite-when-given behaviour — they are edited from the place
 * page and passed by `Plan`, which is a different relationship to the row.
 */
function localityUpdates(details: LocationDetails): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of ["city", "region", "country"] as const) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) {
      updates[key] = value.trim();
    }
  }
  return updates;
}

/**
 * Coordinates and the OSM object, as one unit or not at all.
 *
 * `pointOf` refuses half a pair, so a place is never left on the prime meridian
 * by a caller that knew only a latitude. The OSM reference travels with the
 * pair rather than separately: an id pointing at one venue beside coordinates
 * from another is worse than neither, and `mapLinkFor` prefers the id.
 */
function identityUpdates(details: LocationDetails) {
  const point = pointOf(details);
  if (!point) return null;

  const osmType =
    details.osmType === "N" || details.osmType === "W" || details.osmType === "R"
      ? details.osmType
      : null;
  return {
    latitude: point.lat,
    longitude: point.lon,
    osmType,
    osmId: osmType && details.osmId != null ? BigInt(details.osmId) : null,
  };
}

export async function resolveLocation(
  tx: Prisma.TransactionClient,
  ownerId: string,
  rawName: string | undefined,
  details: LocationDetails = {},
): Promise<{ id: string; name: string } | null> {
  const name = rawName?.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const normalizedName = normalizeLocationName(name);
  const [canonical, existingAlias] = await Promise.all([
    // The canonical namespace is asked first, and its answer wins.
    //
    // A place's own name outranks another place's nickname for it. Asking the
    // alias index first, an account holding a location whose canonical claim
    // is missing — an import, a restore, a repair, or an upgrade caught
    // mid-deployment — while some *other* location carried an alias spelt the
    // same, resolved that name to the other place and never reached the
    // fallback below. Every interaction entered with the real name was filed
    // against the wrong location, and any address or URL typed with it
    // overwrote that location's own.
    tx.location.findUnique({
      where: { ownerId_normalizedName: { ownerId, normalizedName } },
      select: { id: true, name: true },
    }),
    tx.locationAlias.findUnique({
      where: {
        ownerId_normalizedValue: { ownerId, normalizedValue: normalizedName },
      },
      // The id only, never the relation. `LocationAlias` references
      // `Location(ownerId, id)`, so the application cannot write an alias
      // against another account's place — but a restore can, since a dump
      // disables foreign-key checks. Selecting through the relation then hands
      // Prisma a null for a field its schema says is required, and the whole
      // call throws instead of falling back: a row that used to be handled
      // became a crash in every save that mentions the name.
      select: { locationId: true },
    }),
  ]);
  // Fetched separately and owner-scoped, so a claim pointing somewhere this
  // account does not own reads as no claim at all rather than handing back a
  // foreign location — which this function would then attach interactions to,
  // and write `details` onto its address and URL.
  const claimed = existingAlias
    ? await tx.location.findFirst({
        where: { id: existingAlias.locationId, ownerId },
        select: { id: true, name: true },
      })
    : null;
  let existing: { id: string; name: string } | null = canonical ?? claimed;
  // The key is claimed in our own namespace but points somewhere this name
  // does not belong — another account's place, or one of ours that is not the
  // place actually called this. Every write below has to re-point that row
  // rather than insert beside it: the unique index would refuse a second one,
  // and a raw constraint error out of `resolveLocation` reaches the caller as
  // a failed save with nothing to show for it. Claiming it is the repair; the
  // row is ours, and where it points is the part that is wrong.
  const claimIsStale =
    existingAlias !== null &&
    (claimed === null || (canonical !== null && claimed.id !== canonical.id));
  const claimCanonical = async (locationId: string, value: string) => {
    if (claimIsStale) {
      await tx.locationAlias.update({
        where: {
          ownerId_normalizedValue: { ownerId, normalizedValue: normalizedName },
        },
        data: { locationId, value, isCanonical: true },
      });
      return;
    }
    await tx.locationAlias.create({
      data: {
        ownerId,
        locationId,
        value,
        normalizedValue: normalizedName,
        isCanonical: true,
      },
    });
  };
  // Repair the claim for callers that inserted Location directly, for a
  // process straddling an upgrade deployment, and for the conflict above —
  // where the row exists and points at the wrong place, so it is re-pointed
  // rather than left to mislead the next lookup as well.
  if (canonical && (claimIsStale || !claimed))
    await claimCanonical(canonical.id, canonical.name);
  if (existing) {
    // Three writes, not a read followed by one write.
    //
    // Deciding from a read is what made the fill-only rule lose a race: a plain
    // read is a snapshot one, so a date save and the place page could both see a
    // blank city, the page could commit its correction, and the save would then
    // write the old wording over it. Reading `FOR UPDATE` instead does not fix
    // it either — `resolveLocation` has already taken snapshot reads above to
    // find this row, so a locking read of a row that moved since raises MariaDB
    // 1020, `Record has changed since last read`, and the whole save dies rather
    // than the rule holding.
    //
    // So the condition goes in the `WHERE` and the database evaluates it at the
    // moment of writing, against the row as it is then. Nothing is decided from
    // a value that may already be stale, which makes this immune by shape rather
    // than by isolation level — it behaves the same on every version.
    const text = textUpdates(details);
    if (Object.keys(text).length > 0) {
      // `address` and `url` overwrite when given, as they always have: they are
      // edited from the place page and passed by `Plan`, which is a statement
      // about the place rather than one record's recollection of it.
      await tx.location.update({ where: { id: existing.id }, data: text });
    }

    // The locality is shared by everything naming this place, while what a
    // caller passes is one record's wording — often an old one. Each field is
    // written only while it is still empty, so a correction already made cannot
    // be undone. Usually one statement: a date save carries only a city.
    for (const [column, value] of Object.entries(localityUpdates(details))) {
      await tx.location.updateMany({
        where: { id: existing.id, [column]: null },
        data: { [column]: value },
      });
    }

    // Coordinates are filled in, never overwritten, and always as a pair.
    // Typing a venue's name into an interaction must not move a place the user
    // geocoded deliberately — the name is evidence of which place is meant, not
    // of where it is.
    const identity = identityUpdates(details);
    if (identity) {
      await tx.location.updateMany({
        where: { id: existing.id, latitude: null, longitude: null },
        data: identity,
      });
    }

    return existing;
  }
  const created = await tx.location.create({
    data: {
      ownerId,
      name,
      normalizedName,
      ...textUpdates(details),
      // Nothing is set yet, so "fill in what is missing" is everything given —
      // which is how a place first seen by logging a date gets its city.
      ...localityUpdates(details),
      ...(identityUpdates(details) ?? {}),
    },
    select: { id: true, name: true },
  });
  await claimCanonical(created.id, created.name);
  return created;
}
