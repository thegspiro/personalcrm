import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { assistanceAvailable, getAiStatus, resolveApiKey } from "./config";
import {
  quickParse,
  type ParseContact,
  type QuickParseResult,
} from "@/lib/quick-parse";
import { parsePlainDate } from "@/lib/dates";

/**
 * An optional better reading of a quick-add line.
 *
 * This whole directory can be deleted and quick add keeps working —
 * `src/lib/quick-parse.ts` is the feature. This only helps with phrasing the
 * local parser reads badly, and only when you have switched it on and supplied
 * a key.
 *
 * Every failure path returns null so the local reading stands. An error
 * message where a decent guess would do is the wrong trade for something you
 * are about to confirm anyway.
 */

const QuickAddSchema = z.object({
  /**
   * Names as written in the line. Resolved to contacts on our side — the model
   * never sees or returns a database id, so it cannot address a row.
   */
  people: z.array(z.string()).describe("Names of people mentioned, as written"),
  typeSlug: z
    .string()
    .nullable()
    .describe("Slug of the interaction type, from the supplied list, or null"),
  date: z
    .string()
    .nullable()
    .describe("The date as YYYY-MM-DD, or null if the line gives none"),
  title: z.string().describe("A short title for the interaction"),
  notes: z.string().nullable().describe("Any extra commentary, or null"),
});

/** Give up rather than keep the user waiting on a box they could just type in. */
const TIMEOUT_MS = 8_000;

export async function assistedQuickParse(
  input: string,
  _ownerId: string,
  fallback: QuickParseResult,
  context: Parameters<typeof quickParse>[1],
): Promise<QuickParseResult | null> {
  if (!(await assistanceAvailable())) return null;

  const resolved = await resolveApiKey();
  if (!resolved) return null;
  const { model } = await getAiStatus();

  const client = new Anthropic({ apiKey: resolved.key, timeout: TIMEOUT_MS, maxRetries: 1 });

  // The prompt carries the user's own taxonomy and contact names so the model
  // resolves into their vocabulary rather than a generic one.
  const typeList = context.types
    .map((type) => `- ${type.slug}: ${type.label}`)
    .join("\n");
  const nameList = context.contacts
    .map((contact) => [contact.firstName, contact.lastName].filter(Boolean).join(" "))
    .slice(0, 400)
    .join(", ");

  const today = context.now.toISOString().slice(0, 10);

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: zodOutputFormat(QuickAddSchema),
      },
      system: [
        "Extract the parts of a logged interaction from one line of text.",
        `Today is ${today} in the timezone ${context.timeZone}. Resolve relative dates against that, and prefer the past — a bare weekday means the one just gone.`,
        "Interaction types available (use the slug, or null if none fit):",
        typeList || "- (none)",
        nameList ? `Known people: ${nameList}` : "The user has no contacts recorded yet.",
        "Return names exactly as they appear in the input. Do not invent people who are not mentioned.",
      ].join("\n"),
      messages: [{ role: "user", content: input }],
    });

    const parsed = response.parsed_output;
    if (!parsed) return null;

    return merge(parsed, fallback, context);
  } catch {
    // No network, a bad key, a rate limit, a timeout, a malformed response —
    // all the same outcome: the local reading stands.
    return null;
  }
}

/**
 * Fold the model's reading into the local one.
 *
 * People are resolved through the *local* matcher rather than trusted, so the
 * rule about names shared by several contacts still holds: if the model says
 * "John" and two Johns exist, this is still ambiguous and still asks. An
 * assisted parse must not be able to do what the local parse refuses to.
 */
function merge(
  parsed: z.infer<typeof QuickAddSchema>,
  fallback: QuickParseResult,
  context: Parameters<typeof quickParse>[1],
): QuickParseResult {
  // Re-run the local matcher over just the names the model picked out. That
  // reuses one matching rule instead of writing a second one that could drift.
  const namesOnly = parsed.people.join(" and ");
  const resolved = namesOnly
    ? quickParse(namesOnly, { ...context, types: [] })
    : null;

  const type =
    parsed.typeSlug === null
      ? fallback.type
      : (context.types.find((entry) => entry.slug === parsed.typeSlug) ?? fallback.type);

  const date = parsed.date ? (parsePlainDate(parsed.date) ?? fallback.date) : fallback.date;

  return {
    contacts: resolved ? resolved.contacts : fallback.contacts,
    ambiguous: resolved ? resolved.ambiguous : fallback.ambiguous,
    unknownNames: resolved ? resolved.unknownNames : fallback.unknownNames,
    type,
    date,
    dateText: parsed.date ?? fallback.dateText,
    title: parsed.title.trim() || fallback.title,
    notes: parsed.notes?.trim() || fallback.notes,
  };
}

/** Shape check used by the settings screen to verify a pasted key works. */
export async function verifyApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "That key was rejected." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic returned ${error.status}.` };
    }
    return { ok: false, error: "Couldn't reach Anthropic to check the key." };
  }
}

export type { ParseContact };
