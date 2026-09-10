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
    const { getGeoStatus } = await import("./config");
    // One snapshot answers all four questions — switched on, configured,
    // permitted to be typed at, and which endpoint. Read separately, they could
    // describe different settings: an administrator repointing the connection
    // between two of the reads could have the permission describe the new
    // endpoint while the request went to the old one, which is how an
    // interactive query reaches a service whose policy forbids exactly that.
    // It is also three times the queries, since each read loaded the lot.
    const status = await getGeoStatus();
    if (!status.enabled) return { ok: false, reason: "off" };
    if (!status.usable) return { ok: false, reason: "unconfigured" };

    // Re-checked here rather than trusted from the caller: a server action is a
    // public POST endpoint, so "the field only sends this when it is allowed to"
    // is not a guarantee. An endpoint whose operator forbids search-as-you-type
    // must not be reachable that way by a hand-made request either.
    if (options.interactive && !status.typeahead) {
      return { ok: false, reason: "typing-not-allowed" };
    }

    const { searchAddress } = await import("./providers");
    const candidates = await searchAddress(
      { provider: status.provider, baseUrl: status.baseUrl },
      trimmed,
      { interactive: options.interactive },
    );
    // `null` is the endpoint not answering, which is a different thing to say
    // than "nothing matched" — and the difference a field suggesting while you
    // type needs, so that it stops asking rather than spending the timeout
    // again on every pause.
    if (candidates === null) return { ok: false, reason: "failed" };
    return { ok: true, candidates };
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
