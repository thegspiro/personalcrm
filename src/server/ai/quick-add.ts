import "server-only";
import { z } from "zod";
import { assistanceAvailable, currentProviderConfig } from "./config";
import { completeJson, verifyProvider, type ProviderConfig } from "./providers";
import { matchKnownLocation, quickParse, type QuickParseResult } from "@/lib/quick-parse";
import { parsePlainDate } from "@/lib/dates";

/**
 * An optional better reading of a quick-add line.
 *
 * Quick add does not need any of this — `src/lib/quick-parse.ts` is the
 * feature. This only helps with phrasing the local parser reads badly, and only
 * when you have switched it on and pointed it at a model; off, which is how it
 * ships, nothing here runs at all.
 *
 * Note the directory is not straightforwardly *deletable*, though it reads that
 * way: the settings page and its action import the provider table statically.
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
  /**
   * The venue as written in the line, never an id — same rule as `people`. It
   * is re-matched against the user's own places locally, so the model cannot
   * name a place it was not shown or address one by row.
   */
  place: z.string().nullable().default(null),
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
    '{"people":["name as written"],"typeSlug":"slug or null","date":"YYYY-MM-DD or null","place":"venue as written or null","title":"short title","notes":"extra commentary or null"}',
    "",
    `Today is ${today} in timezone ${context.timeZone}. Resolve relative dates against that.`,
    "Prefer the past: a bare weekday means the one just gone, because people log things after they happen.",
    "",
    `Interaction type slugs available: ${types || "(none)"}`,
    names ? `People already known: ${names}` : "The user has no contacts recorded yet.",
    "",
    "Return names exactly as they appear in the input. Never invent a person who is not mentioned.",
    // The user's own place names are deliberately NOT listed here, unlike their
    // contacts: it would be a second disclosure for much less gain, since the
    // local parser already proposes an unrecorded venue and the answer is
    // re-matched locally either way. A decision, not an omission.
    "`place` is a venue named in the line — a cafe, a restaurant, a park. Not somebody's home, and not a city on its own.",
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
  // `types` and `locations` are stripped: this re-parse exists only to resolve
  // names, and a bare list of them must not accidentally match a venue.
  const resolved = namesOnly
    ? quickParse(namesOnly, { ...context, types: [], locations: [] })
    : null;

  // The venue goes back through the local matcher too. A name the model
  // invented simply fails to match and stands as a proposal, which the confirm
  // step shows before anything is written.
  const place = parsed.place?.trim()
    ? (matchKnownLocation(
        parsed.place.trim(),
        context.locations,
        new Set(
          context.types.flatMap((type) => [
            type.label.trim().toLowerCase(),
            type.slug.replace(/-/g, " ").toLowerCase(),
          ]),
        ),
      ).place ?? {
        location: null,
        matchedText: parsed.place.trim(),
        via: "preposition" as const,
      })
    : fallback.place;

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
    place,
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
