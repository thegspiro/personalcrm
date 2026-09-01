import "server-only";
import { prisma } from "@/server/db/client";
import { GEO_PROVIDERS, geoProviderById, type GeoConfig, type GeoProviderId } from "./providers";

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

export interface GeoStatus {
  enabled: boolean;
  provider: GeoProviderId;
  baseUrl: string;
  /** Enough is configured for a lookup to be worth attempting. */
  usable: boolean;
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
  const [enabled, provider, baseUrl] = await Promise.all([
    readSetting(ENABLED),
    readSetting(PROVIDER),
    readSetting(BASE_URL),
  ]);

  const id = (geoProviderById(asString(provider))?.id ?? GEO_PROVIDERS[0].id) as GeoProviderId;
  const definition = geoProviderById(id)!;
  // A fixed endpoint cannot be edited from the app, so a stale stored value
  // must not outlive a change to the table.
  const resolvedBase = definition.baseUrlEditable
    ? asString(baseUrl, definition.defaultBaseUrl)
    : definition.defaultBaseUrl;

  return {
    enabled: enabled === true,
    provider: id,
    baseUrl: resolvedBase,
    usable: Boolean(resolvedBase),
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

export async function setGeoConnection(provider: GeoProviderId, baseUrl: string): Promise<void> {
  await writeSetting(PROVIDER, provider);
  await writeSetting(BASE_URL, baseUrl);
}
