/**
 * Talking to whichever model you actually use.
 *
 * Quick add works with no model at all — `src/lib/quick-parse.ts` is the
 * feature. This is the optional layer, and it deliberately privileges no
 * vendor: an OpenAI-compatible endpoint covers OpenAI, Google's Gemini
 * compatibility layer, Open WebUI, Ollama, LM Studio, vLLM and anything else
 * that speaks the same shape, and Anthropic gets a small adapter of its own
 * because its request format differs.
 *
 * Plain `fetch` rather than a vendor SDK, for two reasons: shipping one
 * provider's client library would quietly make that provider the default, and
 * a self-hosted endpoint on your own network is the case most likely to have
 * a slightly unusual response — easier to be forgiving about that here than
 * through someone else's abstraction.
 *
 * Pure and free of `server-only` so the response handling can be tested
 * directly; `./config.ts` is the wrapper that knows your settings.
 */

export type ProviderId = "openai" | "anthropic" | "google" | "custom";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  /** What to put in the base URL box, when it is editable. */
  defaultBaseUrl: string;
  /** Fixed for hosted services; editable for anything self-hosted. */
  baseUrlEditable: boolean;
  /** A self-hosted endpoint on your own network may not want a key. */
  keyRequired: boolean;
  /** Suggestions only — the model box is free text. */
  suggestedModels: string[];
  /** Anthropic's request shape differs; everything else is OpenAI's. */
  dialect: "openai" | "anthropic";
  note: string;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlEditable: false,
    keyRequired: true,
    suggestedModels: ["gpt-4o-mini", "gpt-4o"],
    dialect: "openai",
    note: "Billed per use by OpenAI.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlEditable: false,
    keyRequired: true,
    suggestedModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    dialect: "anthropic",
    note: "Billed per use by Anthropic.",
  },
  {
    id: "google",
    label: "Google Gemini",
    // Gemini exposes an OpenAI-compatible surface, so it needs no adapter.
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    baseUrlEditable: false,
    keyRequired: true,
    suggestedModels: ["gemini-2.0-flash", "gemini-2.5-pro"],
    dialect: "openai",
    note: "Billed per use by Google.",
  },
  {
    id: "custom",
    label: "Self-hosted or other",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlEditable: true,
    keyRequired: false,
    suggestedModels: ["llama3.1", "qwen2.5", "mistral"],
    dialect: "openai",
    note:
      "Anything that speaks the OpenAI chat API — Open WebUI, Ollama, LM Studio, vLLM, LiteLLM. Nothing leaves your network if the endpoint doesn't.",
  },
];

export function providerById(id: string): ProviderDefinition | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export interface ProviderConfig {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  /** Give up rather than leave someone waiting on a box they could type into. */
  timeoutMs?: number;
}

/**
 * Ask for one JSON object back.
 *
 * Every provider is asked the same way — a system prompt that specifies the
 * shape, and a plain text response we parse ourselves. Provider-specific
 * structured-output features would give tidier guarantees on the two vendors
 * that have them and nothing on a self-hosted box, so the lowest common
 * denominator is the honest choice here.
 */
export async function completeJson(
  config: ProviderConfig,
  request: CompletionRequest,
): Promise<unknown | null> {
  const definition = providerById(config.provider);
  if (!definition) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 8_000);

  try {
    const text =
      definition.dialect === "anthropic"
        ? await callAnthropic(config, request, controller.signal)
        : await callOpenAiCompatible(config, request, controller.signal);
    return text === null ? null : extractJson(text);
  } catch {
    // No network, a refused connection, a timeout, a 500 — all the same
    // outcome for the caller, which is to keep the local reading.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCompatible(
  config: ProviderConfig,
  request: CompletionRequest,
  signal: AbortSignal,
): Promise<string | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A self-hosted endpoint on your own network often has no auth at all.
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const response = await fetch(`${trimBase(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  // Some servers return content as an array of parts rather than a string.
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join("");
  }
  return null;
}

async function callAnthropic(
  config: ProviderConfig,
  request: CompletionRequest,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetch(`${trimBase(config.baseUrl)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (
    body.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("") ?? null
  );
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Pull the first JSON object out of a reply.
 *
 * Models wrap JSON in prose or fences however they like, and a smaller
 * self-hosted one does it more often. Being forgiving here costs a few lines
 * and turns a whole class of "it just never works" into "it works".
 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      // An array or a bare string is a failed reading, not a result — the
      // caller wants one object and anything else must fall back.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

/**
 * Check an endpoint answers before storing its settings.
 *
 * A typo caught here is worth a great deal more than one discovered as
 * "suggestions never seem to do anything".
 */
export async function verifyProvider(
  config: ProviderConfig,
): Promise<{ ok: boolean; error?: string }> {
  const definition = providerById(config.provider);
  if (!definition) return { ok: false, error: "Unknown provider." };
  if (definition.keyRequired && !config.apiKey) return { ok: false, error: "That provider needs a key." };
  if (!config.model) return { ok: false, error: "Say which model to use." };

  const result = await completeJson(config, {
    system: 'Reply with exactly {"ok":true} and nothing else.',
    user: "ping",
    timeoutMs: 15_000,
  });

  if (result === null) {
    return {
      ok: false,
      error: "No usable reply from that endpoint — check the address, key and model name.",
    };
  }
  return { ok: true };
}
