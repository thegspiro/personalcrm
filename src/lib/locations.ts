/**
 * Place identity and map links.
 *
 * Pure and Prisma-free on purpose: the timeline post-filter, the quick-add
 * parser and the place page all need this, and two of those cannot import from
 * `src/server/`. `src/server/services/locations.ts` re-exports the normalizer
 * so the six `resolveLocation` call sites are unaffected.
 */

import { readCoordinate } from "./geo";

/** Conservative identity: whitespace and case are safe; fuzzy matching is not. */
export function normalizeLocationName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** The OSM object a place was matched to. `N`ode, `W`ay or `R`elation. */
export type OsmType = "N" | "W" | "R";

const OSM_PATH: Record<OsmType, string> = { N: "node", W: "way", R: "relation" };

export function isOsmType(value: string | null | undefined): value is OsmType {
  return value === "N" || value === "W" || value === "R";
}

/**
 * Where "Open map" should go, best identity first.
 *
 * The coordinate branch matters: `search?query=38.88,-77.17` runs a *search*
 * for a string that happens to look like a pair of numbers, so even correct
 * coordinates produced a results page rather than a pin. `mlat`/`mlon` is the
 * documented way to ask OpenStreetMap to mark a point.
 */
export function mapLinkFor(place: {
  osmType?: string | null;
  osmId?: bigint | number | string | null;
  latitude?: unknown;
  longitude?: unknown;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  name: string;
}): string {
  // An OSM object is the strongest reference we can hold: it survives a
  // reimport, which Nominatim's own place_id does not.
  if (isOsmType(place.osmType) && place.osmId != null && `${place.osmId}` !== "") {
    return `https://www.openstreetmap.org/${OSM_PATH[place.osmType]}/${place.osmId}`;
  }

  const lat = coordinate(place.latitude);
  const lon = coordinate(place.longitude);
  if (lat !== null && lon !== null) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  }

  // Every part we hold, not just the street. "123 Main St" alone is ambiguous
  // the world over, and the edit form actively encourages a street plus a
  // separate city — so searching the street by itself could land a continent
  // away from the place it names.
  const locality = [place.city, place.region, place.country]
    .map((part) => part?.trim())
    .filter(Boolean);
  const query = [place.address?.trim() || place.name, ...locality].join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

/**
 * The map link wants the coordinate as text, but the parsing rules — `Decimal`
 * from Prisma, a string from a form, blank meaning "not given" rather than
 * zero — are the ones `readCoordinate` already applies for distances. Shared
 * rather than duplicated, so a coordinate cannot be good enough to measure from
 * and not good enough to map, or the other way round.
 */
function coordinate(value: unknown): string | null {
  const parsed = readCoordinate(value);
  return parsed === null ? null : String(parsed);
}
