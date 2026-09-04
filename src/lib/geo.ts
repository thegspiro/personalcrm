/**
 * Distance between two points on the earth.
 *
 * Pure and Prisma-free, like `src/lib/locations.ts` beside it: the plan list,
 * the people page and the places list all need this, and the client components
 * among them cannot import from `src/server/`.
 *
 * Straight-line only, and deliberately so. Every distance in the app is
 * computed here, on this machine, from coordinates already stored — nothing is
 * sent anywhere to produce one. Real travel time needs a routing service, which
 * would be a network call per row; the seam for adding one later behind the
 * same off-by-default gate as address lookup is `DistanceSource` below.
 */

/** How distances read. Stored on `UserPreference.distanceUnit`. */
export type Unit = "mi" | "km";

export function isUnit(value: unknown): value is Unit {
  return value === "mi" || value === "km";
}

export interface Point {
  lat: number;
  lon: number;
}

/**
 * Where a distance came from.
 *
 * Only one value today. It exists so that a routing provider added later can
 * return `"driving"` alongside a `durationMinutes` without any caller of
 * `withDistance` changing shape — the difference between "2 miles away" and
 * "11 minutes away" is worth being explicit about at the point it is rendered.
 */
export type DistanceSource = "straight-line";

export interface Distance {
  /** In the unit that was asked for. */
  value: number;
  unit: Unit;
  source: DistanceSource;
}

/**
 * Prisma hands back `Decimal` for coordinate columns, and a form hands back a
 * string, so accept anything with a sane numeric form rather than assuming a
 * number. Blank and unparseable both read as "not given" rather than as zero —
 * `Number("")` is 0, which is a real coordinate and a silent lie.
 */
export function readCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  const text = typeof value === "object" ? String(value) : `${value}`;
  if (!text.trim()) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const MAX_LAT = 90;
const MAX_LON = 180;

/**
 * Both halves, in range, or nothing.
 *
 * A latitude with no longitude is not a place, and writing one alone puts a
 * point on the prime meridian — the mistake the schema comment on `Location`
 * already warns about. `(0, 0)` is rejected for the same reason: it is in the
 * Gulf of Guinea, and in practice it is always a parse of two empty fields
 * rather than somebody's actual address.
 */
export function pointOf(
  place: { latitude?: unknown; longitude?: unknown } | null | undefined,
): Point | null {
  if (!place) return null;
  const lat = readCoordinate(place.latitude);
  const lon = readCoordinate(place.longitude);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > MAX_LAT || Math.abs(lon) > MAX_LON) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_MI = 1.609344;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  // `min(1, …)` guards the floating-point overshoot that makes asin throw NaN
  // for two points at the same coordinates.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function convertKm(km: number, unit: Unit): number {
  return unit === "km" ? km : km / KM_PER_MI;
}

/** Null whenever either end is missing, so callers never render a false zero. */
export function distanceBetween(
  a: Point | null | undefined,
  b: Point | null | undefined,
  unit: Unit,
): Distance | null {
  if (!a || !b) return null;
  return { value: convertKm(haversineKm(a, b), unit), unit, source: "straight-line" };
}

/**
 * Short enough for a chip on a phone.
 *
 * One decimal place under 10, none above: "0.4 mi" is a useful difference from
 * "0.9 mi", while "23.4 mi" and "23 mi" are the same fact with more digits.
 */
export function formatDistance(distance: Distance | null | undefined): string | null {
  if (!distance) return null;
  const { value, unit } = distance;
  if (!Number.isFinite(value)) return null;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${unit}`;
}

/**
 * Annotate rows with their distance from an origin, optionally nearest first.
 *
 * In process rather than in SQL. MariaDB has `ST_Distance_Sphere`, but reaching
 * it means raw SQL — which would lose both Prisma's typing and, more
 * importantly, the privacy where-fragments that every read in this app is
 * required to apply in the query itself. The row counts here are tens: one
 * account's plans and places, already capped by `src/lib/list-cap.ts`.
 *
 * Rows with no coordinates keep their incoming order behind the ones that have
 * them, rather than sorting to the top as zero or vanishing from the list.
 */
export function withDistance<T>(
  items: readonly T[],
  origin: Point | null | undefined,
  unit: Unit,
  pointFor: (item: T) => Point | null,
  options: { sort?: boolean } = {},
): (T & { distance: Distance | null })[] {
  const annotated = items.map((item) => ({
    ...item,
    distance: distanceBetween(origin, pointFor(item), unit),
  }));
  if (!options.sort) return annotated;

  return annotated
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item.distance?.value ?? null;
      const right = b.item.distance?.value ?? null;
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      return left === right ? a.index - b.index : left - right;
    })
    .map(({ item }) => item);
}
