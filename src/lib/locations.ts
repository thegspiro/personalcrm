/**
 * Place identity and map links.
 *
 * Pure and Prisma-free on purpose: the timeline post-filter, the quick-add
 * parser and the place page all need this, and two of those cannot import from
 * `src/server/`. `src/server/services/locations.ts` re-exports the normalizer
 * so the six `resolveLocation` call sites are unaffected.
 */

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

  const query = place.address?.trim() || place.name;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

/**
 * Prisma hands back `Decimal` for these columns, so accept anything with a
 * sane string form rather than assuming a number.
 */
function coordinate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "object" ? String(value) : `${value}`;
  if (!text.trim()) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? text.trim() : null;
}
