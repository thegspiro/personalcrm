/**
 * Address lookup against OpenStreetMap.
 *
 * Deliberately shaped like `src/server/ai/providers.ts`, and for the same
 * reasons: plain `fetch` rather than a vendor SDK, a small table of endpoints
 * rather than one hard-coded service, and a self-hostable option that is the
 * point rather than an afterthought. The whole `src/server/geo/` directory can
 * be deleted and everything else keeps working — places stay editable by hand.
 *
 * No `server-only` marker, so the pure response-shaping is unit-testable
 * without a request context or a network.
 */

export type GeoProviderId = "nominatim" | "photon" | "custom";

export interface GeoProviderDefinition {
  id: GeoProviderId;
  label: string;
  defaultBaseUrl: string;
  baseUrlEditable: boolean;
  /** Which response shape to read. */
  dialect: "nominatim" | "photon";
  note: string;
}

export const GEO_PROVIDERS: GeoProviderDefinition[] = [
  {
    id: "nominatim",
    label: "OpenStreetMap (Nominatim)",
    defaultBaseUrl: "https://nominatim.openstreetmap.org",
    baseUrlEditable: false,
    dialect: "nominatim",
    note:
      "Free, run by the OpenStreetMap Foundation on donated servers. Their usage policy allows at most one request a second and forbids search-as-you-type, which is why lookup is a button you press rather than something that happens while you type.",
  },
  {
    id: "photon",
    label: "Photon",
    defaultBaseUrl: "https://photon.komoot.io",
    baseUrlEditable: false,
    dialect: "photon",
    note:
      "Also OpenStreetMap data. The public instance is best-effort and throttles heavy use; it is open source, so you can run your own.",
  },
  {
    id: "custom",
    label: "Self-hosted or other",
    defaultBaseUrl: "http://localhost:8080",
    baseUrlEditable: true,
    dialect: "nominatim",
    note:
      "Anything that speaks the Nominatim search API. Nothing leaves your network if the endpoint doesn't.",
  },
];

export function geoProviderById(id: string): GeoProviderDefinition | null {
  return GEO_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export interface GeoConfig {
  provider: GeoProviderId;
  baseUrl: string;
}

/** One candidate the user can accept. Nothing is written until they do. */
export interface GeoCandidate {
  /** What the provider calls this place, for choosing between candidates. */
  label: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  osmType: "N" | "W" | "R" | null;
  osmId: string | null;
}

/**
 * Identify this app to the endpoint.
 *
 * Nominatim rejects the stock User-Agent an HTTP library sends, and a 403 with
 * no explanation is a miserable thing to debug. Their policy asks for something
 * that names the application.
 */
const USER_AGENT = "personalcrm (self-hosted personal relationship manager)";

const TIMEOUT_MS = 8_000;

/**
 * Ask for candidates. Returns an empty list for every failure.
 *
 * Same trade as the AI layer: a lookup that quietly finds nothing is better
 * than an error page in front of a form the user can still fill in by hand.
 */
export async function searchAddress(
  config: GeoConfig,
  query: string,
  limit = 5,
): Promise<GeoCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const definition = geoProviderById(config.provider);
  const dialect = definition?.dialect ?? "nominatim";
  const base = config.baseUrl.replace(/\/+$/, "");
  const url =
    dialect === "photon"
      ? `${base}/api?q=${encodeURIComponent(trimmed)}&limit=${limit}`
      : `${base}/search?q=${encodeURIComponent(trimmed)}&format=jsonv2&addressdetails=1&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return dialect === "photon" ? readPhoton(body) : readNominatim(body);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// --- response shaping ------------------------------------------------------

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const asText = text(value);
  return asText && Number.isFinite(Number(asText)) ? asText : null;
}

/**
 * Nominatim's `osm_type` is spelled out; `place_id` is deliberately ignored.
 * It is an internal key of one instance and changes on reimport, so storing it
 * would give us a reference that silently stops meaning anything.
 */
function osmTypeOf(value: unknown): "N" | "W" | "R" | null {
  const raw = text(value)?.toLowerCase();
  if (raw === "node" || raw === "n") return "N";
  if (raw === "way" || raw === "w") return "W";
  if (raw === "relation" || raw === "r") return "R";
  return null;
}

export function readNominatim(body: unknown): GeoCandidate[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const address = (row.address ?? {}) as Record<string, unknown>;
    const label = text(row.display_name);
    if (!label) return [];
    return [
      {
        label,
        address: label,
        // A place can be a city, a town or a village depending on its size, and
        // the caller only wants one "city".
        city:
          text(address.city) ??
          text(address.town) ??
          text(address.village) ??
          text(address.hamlet),
        region: text(address.state) ?? text(address.county),
        country: text(address.country),
        latitude: coordinate(row.lat),
        longitude: coordinate(row.lon),
        osmType: osmTypeOf(row.osm_type),
        osmId: row.osm_id == null ? null : String(row.osm_id),
      },
    ];
  });
}

export function readPhoton(body: unknown): GeoCandidate[] {
  if (!body || typeof body !== "object") return [];
  const features = (body as Record<string, unknown>).features;
  if (!Array.isArray(features)) return [];

  return features.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const feature = entry as Record<string, unknown>;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const geometry = (feature.geometry ?? {}) as Record<string, unknown>;
    const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];

    const name = text(props.name);
    const street = [text(props.housenumber), text(props.street)].filter(Boolean).join(" ");
    const label = name ?? (street || null);
    if (!label) return [];

    return [
      {
        label: [label, text(props.city), text(props.country)].filter(Boolean).join(", "),
        address: street || name,
        city: text(props.city),
        region: text(props.state) ?? text(props.county),
        country: text(props.country),
        // GeoJSON is [longitude, latitude] — the opposite order to how they are
        // written everywhere else, and an easy way to put a place in the sea.
        longitude: coordinate(coords[0]),
        latitude: coordinate(coords[1]),
        osmType: osmTypeOf(props.osm_type),
        osmId: props.osm_id == null ? null : String(props.osm_id),
      },
    ];
  });
}
