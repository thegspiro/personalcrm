import "server-only";
import { z } from "zod";
import { assistanceAvailable, currentProviderConfig } from "./config";
import { completeJson, verifyProvider, type ProviderConfig } from "./providers";
import { quickParse, type QuickParseResult } from "@/lib/quick-parse";
import { parsePlainDate } from "@/lib/dates";

/**
 * An optional better reading of a quick-add line.
 *
 * This whole directory can be deleted and quick add keeps working —
 * `src/lib/quick-parse.ts` is the feature. This only helps with phrasing the
 * local parser reads badly, and only when you have switched it on and pointed
 * it at a model.
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
  people: z.array(z.string()).default([]),
  typeSlug: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  title: z.string().default(""),
  notes: z.string().nullable().default(null),
});

export async function assistedQuickParse(
  input: string,
  _ownerId: string,
  fallback: QuickParseResult,
  context: Parameters<typeof quickParse>[1],
): Promise<QuickParseResult | null> {
  if (!(await assistanceAvailable())) return null;

  const config = await currentProviderConfig();
  if (!config) return null;

  const raw = await completeJson(config, {
    system: buildPrompt(context),
    user: input,
  });
  if (raw === null) return null;

  const parsed = QuickAddSchema.safeParse(raw);
  // A model that answered with the wrong shape is no worse than one that did
  // not answer: keep the local reading either way.
  if (!parsed.success) return null;

  return merge(parsed.data, fallback, context);
}

/**
 * The instructions, carrying the user's own vocabulary.
 *
 * Their interaction-type slugs and contact names go in so the model resolves
 * into *their* taxonomy rather than a generic one, and the output shape is
 * spelled out because not every endpoint supports a structured-output mode.
 */
function buildPrompt(context: Parameters<typeof quickParse>[1]): string {
  const types = context.types.map((type) => `${type.slug} (${type.label})`).join(", ");
  const names = context.contacts
    .map((contact) => [contact.firstName, contact.lastName].filter(Boolean).join(" "))
    .slice(0, 300)
    .join(", ");
  const today = context.now.toISOString().slice(0, 10);

  return [
    "You extract the parts of a logged personal interaction from one line of text.",
    "Reply with a single JSON object and nothing else — no prose, no code fences.",
    "",
    "Shape:",
    '{"people":["name as written"],"typeSlug":"slug or null","date":"YYYY-MM-DD or null","title":"short title","notes":"extra commentary or null"}',
    "",
    `Today is ${today} in timezone ${context.timeZone}. Resolve relative dates against that.`,
    "Prefer the past: a bare weekday means the one just gone, because people log things after they happen.",
    "",
    `Interaction type slugs available: ${types || "(none)"}`,
    names ? `People already known: ${names}` : "The user has no contacts recorded yet.",
    "",
    "Return names exactly as they appear in the input. Never invent a person who is not mentioned.",
  ].join("\n");
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
  const namesOnly = parsed.people.filter(Boolean).join(" and ");
  const resolved = namesOnly ? quickParse(namesOnly, { ...context, types: [] }) : null;

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

/** Check a connection before storing it. */
export async function verifyConnection(
  config: ProviderConfig,
): Promise<{ ok: boolean; error?: string }> {
  return verifyProvider(config);
}
