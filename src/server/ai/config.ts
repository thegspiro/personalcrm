import "server-only";
import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret, keyHint } from "./crypto";
import { providerById, type ProviderConfig, type ProviderId } from "./providers";

/**
 * Whether the optional assisted reading is available, and against what.
 *
 * Nothing in the app requires this. Quick add parses locally with no model at
 * all; this only decides whether a line is *also* sent somewhere for a better
 * reading of messier phrasing — and "somewhere" is whatever you point it at,
 * including a box on your own network.
 */

const ENABLED = "ai.enabled";
const PROVIDER = "ai.provider";
const BASE_URL = "ai.baseUrl";
const MODEL = "ai.model";
const KEY = "ai.apiKey";

export interface AiStatus {
  /** The toggle. Off until you turn it on. */
  enabled: boolean;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /** Where the key came from — an env var cannot be edited from the app. */
  keySource: "env" | "stored" | null;
  keyHint: string | null;
  /** Enough is configured for a request to be worth attempting. */
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

/**
 * The key to use, if any.
 *
 * An environment variable wins: that is how a container is configured, and it
 * keeps the key out of the database and therefore out of your backups.
 * `AI_API_KEY` is the neutral name; the vendor-specific ones are accepted too
 * because that is what people already have set.
 */
export async function resolveApiKey(): Promise<{ key: string; source: "env" | "stored" } | null> {
  const fromEnv =
    process.env.AI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };

  const stored = await readSetting(KEY);
  if (typeof stored !== "string" || !stored) return null;

  const decrypted = decryptSecret(stored);
  // A key that will not decrypt — a rotated AUTH_SECRET, say — is treated as
  // absent rather than as an error. "No assistance" is a state the app already
  // handles gracefully.
  return decrypted ? { key: decrypted, source: "stored" } : null;
}

export async function getAiStatus(): Promise<AiStatus> {
  const [enabled, provider, baseUrl, model, resolved] = await Promise.all([
    readSetting(ENABLED),
    readSetting(PROVIDER),
    readSetting(BASE_URL),
    readSetting(MODEL),
    resolveApiKey(),
  ]);

  const id = (providerById(asString(provider)) ?? providerById("openai"))!;
  const effectiveBase = asString(baseUrl, id.defaultBaseUrl);
  const effectiveModel = asString(model, id.suggestedModels[0] ?? "");

  return {
    enabled: enabled === true,
    provider: id.id,
    baseUrl: id.baseUrlEditable ? effectiveBase : id.defaultBaseUrl,
    model: effectiveModel,
    hasKey: Boolean(resolved),
    keySource: resolved?.source ?? null,
    keyHint: resolved ? keyHint(resolved.key) : null,
    usable: Boolean(effectiveModel) && (!id.keyRequired || Boolean(resolved)),
  };
}

/** The settings as the provider layer wants them, or null if unusable. */
export async function currentProviderConfig(): Promise<ProviderConfig | null> {
  const status = await getAiStatus();
  if (!status.usable) return null;

  const resolved = await resolveApiKey();
  return {
    provider: status.provider,
    baseUrl: status.baseUrl,
    apiKey: resolved?.key ?? null,
    model: status.model,
  };
}

/** Both conditions, in one place: switched on and actually configured. */
export async function assistanceAvailable(): Promise<boolean> {
  const status = await getAiStatus();
  return status.enabled && status.usable;
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
  await writeSetting(ENABLED, enabled);
}

export async function setAiConnection(input: {
  provider: string;
  baseUrl?: string;
  model: string;
}): Promise<void> {
  const definition = providerById(input.provider);
  if (!definition) return;

  await writeSetting(PROVIDER, definition.id);
  await writeSetting(MODEL, input.model);
  await writeSetting(
    BASE_URL,
    definition.baseUrlEditable ? (input.baseUrl ?? definition.defaultBaseUrl) : definition.defaultBaseUrl,
  );
}

export async function storeApiKey(key: string): Promise<void> {
  await writeSetting(KEY, encryptSecret(key.trim()));
}

export async function clearApiKey(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
}
