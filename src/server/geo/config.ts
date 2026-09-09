import "server-only";
import { prisma } from "@/server/db/client";
import {
  GEO_PROVIDERS,
  geoProviderById,
  typeaheadAllowed,
  type GeoConfig,
  type GeoProviderId,
  type LookupUi,
} from "./providers";

/**
 * The address-lookup toggle.
 *
 * Off until switched on, like the AI layer and for the same reason: this is the
 * only other thing in the app that sends anything anywhere. When it is off,
 * nothing is sent, and places stay editable by hand.
 *
 * Settings live in `AppSetting` rather than `UserPreference` because the
 * endpoint is a property of the installation, not of a person.
 */

const ENABLED = "geo.enabled";
const PROVIDER = "geo.provider";
const BASE_URL = "geo.baseUrl";
/**
 * Suggestions while you type, which is a second decision rather than part of
 * the first.
 *
 * `docs/privacy.md` rule 2 says nothing is sent except when you press the
 * button — not only because Nominatim's policy demands it, but because it is
 * the rule we would want regardless. Switching on the lookup is consent to send
 * an address when asked; it is not consent to send one every time you pause.
 * So this is its own key, and absent means off.
 */
const TYPEAHEAD = "geo.typeahead";

export interface GeoStatus {
  enabled: boolean;
  provider: GeoProviderId;
  baseUrl: string;
  /** Enough is configured for a lookup to be worth attempting. */
  usable: boolean;
  /**
   * Whether the configured endpoint permits search-as-you-type at all — the
   * question of whether to *offer* the switch, independent of the answer.
   */
  typeaheadCapable: boolean;
  /**
   * Whether suggestions should actually fire while typing: switched on, usable,
   * permitted by the endpoint, and asked for. One field so that a caller
   * cannot get the combination wrong.
   */
  typeahead: boolean;
}

async function readSetting(key: string): Promise<unknown> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback;
}

export async function getGeoStatus(): Promise<GeoStatus> {
  const [enabled, provider, baseUrl, typeahead] = await Promise.all([
    readSetting(ENABLED),
    readSetting(PROVIDER),
    readSetting(BASE_URL),
    readSetting(TYPEAHEAD),
  ]);

  const id = (geoProviderById(asString(provider))?.id ?? GEO_PROVIDERS[0].id) as GeoProviderId;
  const definition = geoProviderById(id)!;
  // A fixed endpoint cannot be edited from the app, so a stale stored value
  // must not outlive a change to the table.
  const resolvedBase = definition.baseUrlEditable
    ? asString(baseUrl, definition.defaultBaseUrl)
    : definition.defaultBaseUrl;

  const usable = Boolean(resolvedBase);
  const capable = typeaheadAllowed({ provider: id, baseUrl: resolvedBase });

  return {
    enabled: enabled === true,
    provider: id,
    baseUrl: resolvedBase,
    usable,
    typeaheadCapable: capable,
    // The stored answer is kept even while the endpoint cannot honour it, so
    // moving to Nominatim and back does not silently forget the choice.
    typeahead: enabled === true && usable && capable && typeahead === true,
  };
}

/**
 * What the address forms need, in the one shape they all take.
 *
 * A single prop rather than a pair of booleans the three surfaces could each
 * combine differently — which they already did: the place page asked only
 * whether lookup was enabled, while the other two also required it to be
 * usable.
 */
export async function getLookupUi(): Promise<LookupUi> {
  const status = await getGeoStatus();
  const definition = geoProviderById(status.provider)!;
  let endpointHost = status.baseUrl;
  try {
    endpointHost = new URL(status.baseUrl).host;
  } catch {
    // Keep the raw value; it is only ever shown, never fetched.
  }
  return {
    enabled: status.enabled && status.usable,
    typeahead: status.typeahead,
    providerLabel: definition.label,
    endpointHost,
  };
}

/** The single gate. Nothing in this directory runs unless this is true. */
export async function lookupAvailable(): Promise<boolean> {
  const status = await getGeoStatus();
  return status.enabled && status.usable;
}

export async function currentGeoConfig(): Promise<GeoConfig | null> {
  const status = await getGeoStatus();
  if (!status.usable) return null;
  return { provider: status.provider, baseUrl: status.baseUrl };
}

export async function setGeoEnabled(enabled: boolean): Promise<void> {
  await writeSetting(ENABLED, enabled);
}

export async function setGeoTypeahead(enabled: boolean): Promise<void> {
  await writeSetting(TYPEAHEAD, enabled);
}

export async function setGeoConnection(provider: GeoProviderId, baseUrl: string): Promise<void> {
  await writeSetting(PROVIDER, provider);
  await writeSetting(BASE_URL, baseUrl);
}

/**
 * Whether suggestions while typing are switched on, permitted and usable.
 *
 * The gate `searchPlaces` consults before it will answer an interactive
 * request, so the rule holds however the action is reached rather than only
 * where the field decides not to ask.
 */
export async function typeaheadEnabled(): Promise<boolean> {
  return (await getGeoStatus()).typeahead;
}
