import "server-only";
import type { GeoCandidate } from "./providers";

/**
 * The one address-lookup gate.
 *
 * Both callers — the place editor and a contact's address — need the same three
 * things: the toggle checked, the whole optional directory reached behind a
 * dynamic `import()` so a build that never turns it on never loads it, and every
 * failure landing as "found nothing" rather than an error page in front of a
 * form the user can still fill in by hand. Written once here so the two cannot
 * drift into two different failure stories.
 */

export type LookupOutcome =
  | { ok: true; candidates: GeoCandidate[] }
  /** Switched off, or on but with nothing usable configured. */
  | { ok: false; reason: "off" | "unconfigured" | "failed" | "typing-not-allowed" };

export async function searchPlaces(
  query: string,
  options: { interactive?: boolean } = {},
): Promise<LookupOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, candidates: [] };

  try {
    const { lookupAvailable, currentGeoConfig, typeaheadEnabled } = await import("./config");
    if (!(await lookupAvailable())) return { ok: false, reason: "off" };

    const config = await currentGeoConfig();
    if (!config) return { ok: false, reason: "unconfigured" };

    // Re-checked here rather than trusted from the caller: a server action is a
    // public POST endpoint, so "the field only sends this when it is allowed to"
    // is not a guarantee. An endpoint whose operator forbids search-as-you-type
    // must not be reachable that way by a hand-made request either.
    if (options.interactive && !(await typeaheadEnabled())) {
      return { ok: false, reason: "typing-not-allowed" };
    }

    const { searchAddress } = await import("./providers");
    return {
      ok: true,
      candidates: await searchAddress(config, trimmed, { interactive: options.interactive }),
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** What each outcome should say to somebody looking at a form. */
export const LOOKUP_MESSAGES: Record<
  "off" | "unconfigured" | "failed" | "typing-not-allowed",
  string
> = {
  off: "Address lookup is switched off. Turn it on in Settings.",
  unconfigured: "Address lookup isn't configured.",
  failed: "That lookup didn't work. You can still fill the address in by hand.",
  "typing-not-allowed":
    "This endpoint doesn't allow suggestions while you type. Press the button instead.",
};
