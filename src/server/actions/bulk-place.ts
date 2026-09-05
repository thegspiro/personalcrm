"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner, str } from "./helpers";
import { countUnplaced, listUnplaced, type UnplacedKind } from "@/server/queries/unplaced";
import { isOsmType } from "@/lib/locations";
import { pointOf } from "@/lib/geo";

/**
 * Put everything on the map that can be put there unambiguously.
 *
 * The one-at-a-time button is fine for a place you are looking at; it is not a
 * way to place the two hundred addresses an account already has. This walks
 * them, and is deliberately unremarkable: no queue, no job table, no background
 * worker. A bounded batch that reports where it got to, called again by the
 * browser until there is nothing left.
 *
 * Only offered against a self-hosted endpoint. Nominatim's usage policy caps an
 * application at roughly one request a second *and* forbids bulk geocoding
 * against the servers the OpenStreetMap Foundation runs on donations — a
 * hundred addresses in a loop is exactly what that forbids, however politely it
 * is paced. `isRateLimited` already tells the public instance from your own.
 */

/** Small enough that one press is a few seconds even at one request a second. */
const BATCH = 10;

export interface BulkPlaceProgress {
  /** Rows looked at in this call. */
  processed: number;
  /** Rows given coordinates. */
  placed: number;
  /** Rows the answer was too ambiguous to write. They need a person. */
  skipped: number;
  /** Pass this back to continue. Null when there is nothing after it. */
  nextCursor: string | null;
  /** Still unplaced beyond the cursor, for the progress line. */
  remaining: number;
}

function kindOf(value: string | undefined): UnplacedKind | null {
  return value === "places" || value === "addresses" ? value : null;
}

export async function placeUnplaced(
  form: FormData,
): Promise<ActionResult<BulkPlaceProgress>> {
  const { ownerId } = await owner();

  const kind = kindOf(str(form, "kind"));
  if (!kind) return fail("Say whether to place saved places or addresses.");
  const cursor = str(form, "cursor") ?? null;

  // The gate, and then the endpoint check on top of it. Both are re-read here
  // rather than trusted from the form: this is a public POST like every other
  // action, and the one that sends the most data anywhere.
  const { lookupAvailable, currentGeoConfig } = await import("@/server/geo/config");
  if (!(await lookupAvailable())) {
    return fail("Address lookup is switched off. Turn it on in Settings.");
  }
  const config = await currentGeoConfig();
  if (!config) return fail("Address lookup isn't configured.");

  const { isRateLimited, searchAddress } = await import("@/server/geo/providers");
  if (isRateLimited(config.baseUrl)) {
    return fail(
      "Placing everything at once needs your own lookup endpoint. The public OpenStreetMap service asks applications not to geocode in bulk.",
    );
  }

  const rows = await listUnplaced(ownerId, kind, BATCH, cursor);
  if (rows.length === 0) {
    return ok({ processed: 0, placed: 0, skipped: 0, nextCursor: null, remaining: 0 });
  }

  let placed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.query) {
      skipped += 1;
      continue;
    }

    // Two, so "exactly one" can be told from "more than one" without asking for
    // a page of answers nobody will read.
    const candidates = await searchAddress(config, row.query, 2);

    // Nobody is here to choose. `normalizeLocationName` already sets the house
    // position — whitespace and case are safe, fuzzy matching is not — and a
    // pin in the wrong city is worse than no pin, because it looks answered.
    // So anything but a single unambiguous match is left for a person.
    const only = candidates.length === 1 ? candidates[0] : null;
    const point = only ? pointOf(only) : null;
    if (!only || !point) {
      skipped += 1;
      continue;
    }

    const osmType = isOsmType(only.osmType) ? only.osmType : null;
    const identity = {
      latitude: point.lat,
      longitude: point.lon,
      osmType,
      osmId: osmType && only.osmId ? BigInt(only.osmId) : null,
    };

    // Scoped in the where clause, and still requiring both coordinates to be
    // null: a row placed by hand in another tab while this ran must not be
    // overwritten by a machine's guess.
    const written =
      kind === "addresses"
        ? await prisma.address.updateMany({
            where: {
              id: row.id,
              latitude: null,
              longitude: null,
              contact: { ownerId, isPrivate: false },
            },
            data: identity,
          })
        : await prisma.location.updateMany({
            where: { id: row.id, ownerId, latitude: null, longitude: null },
            data: identity,
          });

    if (written.count > 0) placed += 1;
    else skipped += 1;
  }

  const nextCursor = rows[rows.length - 1].id;
  const remaining = await countUnplaced(ownerId, kind, nextCursor);

  // Only when something actually moved. The browser calls this once per batch,
  // so revalidating unconditionally would throw the whole layout cache away
  // twenty times over for a pass that placed nothing.
  if (placed > 0) revalidatePath("/", "layout");

  return ok({
    processed: rows.length,
    placed,
    skipped,
    // Nothing after this page means the pass is done, whatever is still
    // unplaced behind the cursor — those were the ones nobody could match.
    nextCursor: remaining > 0 ? nextCursor : null,
    remaining,
  });
}
