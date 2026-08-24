import "server-only";
import { prisma } from "@/server/db/client";
import { decryptSecret, encryptSecret, keyHint } from "./crypto";

/**
 * Whether the optional assisted reading is available, and how.
 *
 * Nothing in the app requires this. Quick add parses locally with no key at
 * all; this only decides whether a line is *also* sent to Claude for a better
 * reading of messier phrasing.
 */

const KEY_SETTING = "ai.apiKey";
const MODEL_SETTING = "ai.model";
const ENABLED_SETTING = "ai.enabled";

/** Models worth offering. Cost per million tokens, for the settings screen. */
export const AI_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", cost: "$5 / $25 per million tokens" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", cost: "$3 / $15 per million tokens" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", cost: "$1 / $5 per million tokens" },
] as const;

export const DEFAULT_MODEL = "claude-opus-5";

export interface AiStatus {
  /** The toggle. Off until you turn it on. */
  enabled: boolean;
  /** A key is available from somewhere. */
  hasKey: boolean;
  /** Where it came from — the env var can't be edited from the app. */
  keySource: "env" | "stored" | null;
  keyHint: string | null;
  model: string;
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

/**
 * The key to use, if any.
 *
 * The environment wins: that is how a container is configured, it keeps the
 * key out of the database entirely, and it means a backup never carries it.
 */
export async function resolveApiKey(): Promise<{ key: string; source: "env" | "stored" } | null> {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };

  const stored = await readSetting(KEY_SETTING);
  if (typeof stored !== "string" || !stored) return null;

  const decrypted = decryptSecret(stored);
  // A key that will not decrypt — a changed AUTH_SECRET, say — is treated as
  // absent rather than as an error. "No assistance" is a state the app
  // already handles gracefully.
  return decrypted ? { key: decrypted, source: "stored" } : null;
}

export async function getAiStatus(): Promise<AiStatus> {
  const [resolved, enabled, model] = await Promise.all([
    resolveApiKey(),
    readSetting(ENABLED_SETTING),
    readSetting(MODEL_SETTING),
  ]);

  return {
    enabled: enabled === true,
    hasKey: Boolean(resolved),
    keySource: resolved?.source ?? null,
    keyHint: resolved ? keyHint(resolved.key) : null,
    model: typeof model === "string" && model ? model : DEFAULT_MODEL,
  };
}

/** Both conditions, in one place: switched on and actually usable. */
export async function assistanceAvailable(): Promise<boolean> {
  const status = await getAiStatus();
  return status.enabled && status.hasKey;
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
  await writeSetting(ENABLED_SETTING, enabled);
}

export async function setAiModel(model: string): Promise<void> {
  if (!AI_MODELS.some((entry) => entry.id === model)) return;
  await writeSetting(MODEL_SETTING, model);
}

export async function storeApiKey(key: string): Promise<void> {
  await writeSetting(KEY_SETTING, encryptSecret(key.trim()));
}

export async function clearApiKey(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: KEY_SETTING } });
}
