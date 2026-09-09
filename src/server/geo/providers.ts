/**
 * Address lookup against OpenStreetMap.
 *
 * Deliberately shaped like `src/server/ai/providers.ts`, and for the same
 * reasons: plain `fetch` rather than a vendor SDK, a small table of endpoints
 * rather than one hard-coded service, and a self-hostable option that is the
 * point rather than an afterthought. Switched off — the shipped state — nothing
 * here runs at all, and places stay editable by hand; the action that performs a
 * lookup reaches this behind a dynamic `import()` in a `try`, so a missing or
 * unreachable endpoint finds nothing rather than breaking the page.
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
  /**
   * Whether this provider's *default* endpoint permits search-as-you-type.
   *
   * A property of whose hardware answers, not of what we would like. Nominatim's
   * usage policy forbids it outright; Photon is built on a search index for
   * exactly this and its public instance says so; a self-hosted endpoint is
   * nobody else's to protect. `typeaheadAllowed` is the runtime question,
   * because an editable endpoint can be pointed somewhere this flag did not
   * anticipate.
   */
  typeahead: boolean;
  note: string;
}

export const GEO_PROVIDERS: GeoProviderDefinition[] = [
  {
    id: "nominatim",
    label: "OpenStreetMap (Nominatim)",
    defaultBaseUrl: "https://nominatim.openstreetmap.org",
    baseUrlEditable: false,
    dialect: "nominatim",
    typeahead: false,
    note:
      "Free, run by the OpenStreetMap Foundation on donated servers. Their usage policy allows at most one request a second and forbids search-as-you-type, so lookup here is always a button you press rather than something that happens while you type.",
  },
  {
    id: "photon",
    label: "Photon",
    defaultBaseUrl: "https://photon.komoot.io",
    // Editable, unlike Nominatim's: Photon is much lighter to self-host, and
    // the endpoint is the only way to say so. Pinned to the public instance it
    // was unreachable on your own network, because the one editable entry
    // speaks the other dialect.
    baseUrlEditable: true,
    dialect: "photon",
    typeahead: true,
    note:
      "Also OpenStreetMap data, and built for search-as-you-type — this is the one that can suggest addresses while you type. The public instance is best-effort and throttles heavy use; it is open source and considerably lighter to run than Nominatim, so point this at your own if you have one.",
  },
  {
    id: "custom",
    label: "Self-hosted or other",
    defaultBaseUrl: "http://localhost:8080",
    baseUrlEditable: true,
    dialect: "nominatim",
    typeahead: true,
    note:
      "Anything that speaks the Nominatim search API. Nothing leaves your network if the endpoint doesn't, which is also why it may suggest as you type — unless you point it back at the public OpenStreetMap service, whose policy still applies.",
  },
];

export function geoProviderById(id: string): GeoProviderDefinition | null {
  return GEO_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export interface GeoConfig {
  provider: GeoProviderId;
  baseUrl: string;
}

/**
 * What a form needs to know about the lookup, in one object.
 *
 * One prop rather than two booleans that can disagree, and it carries the
 * provider's name so a field that suggests while you type can say where the
 * suggestions come from. Declared here rather than in `config.ts` because this
 * module has no `server-only` marker and client components may import it.
 */
export interface LookupUi {
  /** Switched on and configured — the "Look up" button is worth offering. */
  enabled: boolean;
  /** Suggestions may be fetched while the user is still typing. */
  typeahead: boolean;
  providerLabel: string;
  /** The host the suggestions come from, for the hint beside the field. */
  endpointHost: string;
}

/**
 * How much has to be typed before a suggestion is worth a request.
 *
 * Exported so the client, the server and the tests share one number rather
 * than three that drift.
 */
export const TYPEAHEAD_MIN_QUERY = 4;

/** One candidate the user can accept. Nothing is written until they do. */
export interface GeoCandidate {
  /** What the provider calls this place, for choosing between candidates. */
  label: string;
  address: string | null;
  /**
   * The street line alone — house number and road, nothing else.
   *
   * Separate from `address` because the two dialects disagree about what that
   * field means: Photon's is the street, Nominatim's is the entire display name
   * down to the country. Filling a form's first address line needs the street,
   * and putting "120 Maple Street, Arlington, Virginia, 22201, United States"
   * there is worse than leaving what the user typed.
   */
  street: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  osmType: "N" | "W" | "R" | null;
  osmId: string | null;
}

/**
 * The candidate as a client component may receive it.
 *
 * Identical to `GeoCandidate` today, and separate anyway: this is the shape
 * that crosses to the browser, so it is the one that must never grow a `BigInt`
 * or a `Decimal` — neither survives serialisation into a client component.
 * Coordinates and the OSM id stay strings the whole way across.
 */
export type GeoCandidateView = GeoCandidate;

export function toCandidateView(candidate: GeoCandidate): GeoCandidateView {
  return {
    label: candidate.label,
    address: candidate.address,
    street: candidate.street,
    city: candidate.city,
    region: candidate.region,
    country: candidate.country,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    osmType: candidate.osmType,
    osmId: candidate.osmId,
  };
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
 * The budget while somebody is typing.
 *
 * A suggestion that lands eight seconds later is not a suggestion, and a server
 * action cannot be aborted from the browser — so a slow one holds the queue
 * behind it, including the Save the user presses next.
 */
const INTERACTIVE_TIMEOUT_MS = 3_000;

/**
 * Endpoints run for everyone, on somebody else's donated hardware.
 *
 * Nominatim's policy caps an application at one request a second across all of
 * its users. A button press is not a fast loop, but two people on one
 * installation clicking at once are two requests in the same instant, and the
 * penalty is throttling or a block that this module would surface as "found
 * nothing" — indistinguishable from a bad address.
 */
const RATE_LIMITED_HOSTS = new Set(["nominatim.openstreetmap.org"]);

/** A little over a second, since the limit is a ceiling rather than a target. */
const RATE_LIMITED_INTERVAL_MS = 1_100;

/**
 * Every other endpoint we do not run ourselves.
 *
 * Photon's public instance has no published per-second cap but throttles heavy
 * use, and typing turns one lookup into several. Small enough that a person
 * never notices it, large enough that an installation cannot become a fast loop
 * against hardware somebody else pays for.
 */
const SHARED_INTERVAL_MS = 300;

export function isRateLimited(baseUrl: string): boolean {
  try {
    return RATE_LIMITED_HOSTS.has(new URL(baseUrl).host.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * An endpoint on this machine or this network — nobody else's to protect.
 *
 * Deliberately conservative: a self-hosted Photon behind a public DNS name is
 * not recognised here and simply gets the shared spacing, which costs its owner
 * 300ms and nothing else. Guessing the other way would take a stranger's server
 * for our own.
 */
export function isPrivateHost(baseUrl: string): boolean {
  let host: string;
  try {
    // `hostname` rather than `host`: the port is not part of this question, and
    // an IPv6 literal arrives here without its brackets.
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  // Anything out of range is a hostname that merely looks like an address.
  if (parts.some((part) => part > 255)) return false;

  const [first, second] = parts;
  if (first === 127 || first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
}

/** How long to leave between requests to this endpoint. */
export function minIntervalFor(baseUrl: string): number {
  if (isRateLimited(baseUrl)) return RATE_LIMITED_INTERVAL_MS;
  if (isPrivateHost(baseUrl)) return 0;
  return SHARED_INTERVAL_MS;
}

/**
 * Whether suggestions may be fetched while the user is still typing.
 *
 * Both halves are load-bearing. The table says what the provider's operator
 * permits; `isRateLimited` catches the case the table cannot see — a "custom"
 * endpoint pointed back at the public OpenStreetMap service, whose policy
 * forbids this however it is reached.
 */
export function typeaheadAllowed(config: GeoConfig): boolean {
  const definition = geoProviderById(config.provider);
  if (!definition?.typeahead) return false;
  return !isRateLimited(config.baseUrl);
}

// Installation-wide because the module is a singleton in the server process,
// which for this app is the whole installation.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let waiting = 0;

/**
 * Whether this request would have to wait its turn.
 *
 * Only interesting while typing: a keystroke that has to queue is answering a
 * prefix the user has already moved past, so it is better dropped than served
 * late. A pressed button waits, because somebody is looking at it.
 */
function wouldWait(baseUrl: string): boolean {
  const interval = minIntervalFor(baseUrl);
  if (interval === 0) return false;
  return waiting > 0 || Date.now() - lastRequestAt < interval;
}

function spaceOutRequests(baseUrl: string): Promise<void> {
  const interval = minIntervalFor(baseUrl);
  if (interval === 0) return Promise.resolve();

  waiting += 1;
  const turn = queue.then(async () => {
    const since = Date.now() - lastRequestAt;
    if (since < interval) {
      await new Promise((resolve) => setTimeout(resolve, interval - since));
    }
    lastRequestAt = Date.now();
    waiting -= 1;
  });
  // The queue must not stay rejected, or one failure blocks every later call.
  queue = turn.catch(() => {
    waiting -= 1;
  });
  return turn;
}

/**
 * Ask for candidates. Returns an empty list for every failure.
 *
 * Same trade as the AI layer: a lookup that quietly finds nothing is better
 * than an error page in front of a form the user can still fill in by hand.
 */
export interface SearchOptions {
  limit?: number;
  /**
   * The user is still typing.
   *
   * Two differences, both about not making somebody wait for an answer they
   * have already moved past: a much shorter budget, and a request that would
   * have to queue is dropped rather than served late.
   */
  interactive?: boolean;
}

export async function searchAddress(
  config: GeoConfig,
  query: string,
  options: SearchOptions = {},
): Promise<GeoCandidate[]> {
  const { limit = 5, interactive = false } = options;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const definition = geoProviderById(config.provider);
  const dialect = definition?.dialect ?? "nominatim";
  const base = config.baseUrl.replace(/\/+$/, "");
  const url =
    dialect === "photon"
      ? `${base}/api?q=${encodeURIComponent(trimmed)}&limit=${limit}`
      : `${base}/search?q=${encodeURIComponent(trimmed)}&format=jsonv2&addressdetails=1&limit=${limit}`;

  if (interactive && wouldWait(base)) return [];

  // Waited out before the timeout starts, so queueing does not eat the budget
  // the request itself gets.
  await spaceOutRequests(base);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    interactive ? INTERACTIVE_TIMEOUT_MS : TIMEOUT_MS,
  );
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
    // `addressdetails=1` is always requested, so the parts are here to be had.
    // The road is what makes a street line: a result without one — a city, a
    // park — yields nothing rather than the display name, which is not a
    // street, and a house number on its own, which is just "120".
    const road = text(address.road);
    const street = road ? [text(address.house_number), road].filter(Boolean).join(" ") : null;
    return [
      {
        label,
        address: label,
        street,
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
        street: street || null,
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
