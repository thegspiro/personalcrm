"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { normalizeLocationName } from "@/lib/locations";
import { locationVisibleWhere } from "@/server/queries/locations";
import { privacyScope } from "@/server/privacy/filter";
import {
  type ActionResult,
  fail,
  fieldError,
  invalid,
  ok,
  owner,
  str,
} from "./helpers";

/**
 * Editing a place.
 *
 * Until now a place could only be born as a side effect of logging something,
 * which left `address`, `city`, `region`, `country`, `phone` and `notes`
 * unfillable by anyone and made a typo permanent.
 *
 * Nothing here destroys anything: a rename leaves every interaction's verbatim
 * label alone — past entries keep the words typed at the time — and archiving
 * hides a place from the lists while its history stays reachable.
 */

/**
 * A name as the `(ownerId, normalizedValue)` index will compare it.
 *
 * The column is utf8mb4_unicode_ci, which folds accents as well as case;
 * `normalizeLocationName`, which decides what is *stored*, deliberately does
 * not. Two spellings that differ only by an accent are therefore one key in
 * the database and two everywhere else, and inserting both is a constraint
 * error rather than a message on the form. This is only ever used to compare
 * — nothing built from it is written.
 */
function indexKey(value: string): string {
  return normalizeLocationName(value)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

const schema = z.object({
  name: z.string().trim().min(1, "Give the place a name.").max(191),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(64).optional(),
  url: z.string().trim().url("That isn't a valid link.").max(500).optional(),
  notes: z.string().trim().optional(),
  aliases: z.string().max(4000).optional(),
});

/**
 * What an accepted lookup candidate may contain.
 *
 * Bounded to the same column limits `updateLocation` enforces, because the
 * values come from an endpoint the app does not control.
 */
const lookupSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  osmType: z.enum(["N", "W", "R"]).optional(),
  // Digits only, and inside a signed 64-bit column. OSM ids passed 2^32 long
  // ago and keep climbing, so this is a string until the moment it is written.
  osmId: z
    .string()
    .regex(/^\d+$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n)
    .optional(),
});

/**
 * The row, but only if the lock would let this person see it.
 *
 * Scoping by `{ id, ownerId }` alone is not enough. While the lock is closed, a
 * place known only through hidden interactions must not be editable — and the
 * difference between "not found" and a field error is itself enough to confirm
 * that it exists, so both paths have to look the same.
 */
async function visibleLocation(ownerId: string, id: string) {
  const scope = await privacyScope();
  return prisma.location.findFirst({
    where: { id, ...locationVisibleWhere(ownerId, scope) },
    select: { id: true, normalizedName: true, locationAliases: true },
  });
}

function touch(id: string) {
  revalidatePath("/locations");
  revalidatePath(`/locations/${id}`);
  // Profiles list the places visited with someone by name.
  revalidatePath("/people");
  revalidatePath("/timeline");
}

export async function updateLocation(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Which place?");

  const existing = await visibleLocation(ownerId, id);
  if (!existing) return fail("That place wasn't found.");

  const parsed = schema.safeParse({
    name: form.get("name") ?? "",
    address: str(form, "address"),
    city: str(form, "city"),
    region: str(form, "region"),
    country: str(form, "country"),
    phone: str(form, "phone"),
    url: str(form, "url"),
    notes: str(form, "notes"),
    aliases: str(form, "aliases"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const name = parsed.data.name.replace(/\s+/g, " ");
  const normalizedName = normalizeLocationName(name);
  // One per line, which is what the field asks for and how it is rendered
  // back. Splitting on commas as well took "Washington, D.C." to be two
  // places, and left the generic half of it resolving quick-add text to the
  // wrong venue.
  // Deduplicated on the key the *index* compares by, not the one stored.
  // `normalizeLocationName` is deliberately conservative — whitespace and case
  // only — while `(ownerId, normalizedValue)` is utf8mb4_unicode_ci, which
  // also folds accents. "Cafe" and "Café" were therefore two entries here and
  // one key there, so both reached `createMany` and an ordinary place edit
  // died on a constraint error. The stored `normalizedValue` is unchanged;
  // only the comparison is widened to match what the database will do.
  const aliasByKey = new Map<string, string>();
  for (const value of (parsed.data.aliases ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)) {
    // First spelling wins, so the choice does not depend on the order the
    // duplicates happen to appear in and re-saving the form is stable.
    if (!aliasByKey.has(indexKey(value))) aliasByKey.set(indexKey(value), value);
  }
  const aliases = Array.from(aliasByKey.values())
    .map((value) => ({ value, normalizedValue: normalizeLocationName(value) }))
    .filter(({ value }) => indexKey(value) !== indexKey(name));

  // Each one is a row of its own, in a column the combined 4,000-character
  // bound on the whole field says nothing about; over it, createMany throws
  // a length error nobody catches.
  if (aliases.some(({ value, normalizedValue }) => value.length > 191 || normalizedValue.length > 191))
    return fieldError("aliases", "Keep each alternate name under 191 characters.");

  if (normalizedName !== existing.normalizedName) {
    // Renaming is refused outright while the lock is closed — every rename,
    // not only the ones that collide.
    //
    // Enforcing uniqueness necessarily answers "is this name already taken",
    // and a name that is taken but matches nothing you can see is a place the
    // lock is hiding. So the collision check below was an oracle: guess a
    // hidden place's name and the error confirmed it exists, while asking for
    // it directly deliberately says only "not found". Softening the wording
    // would not have helped; the signal is the refusal, not the sentence.
    //
    // This answer depends on nothing hidden, so it discloses nothing. Every
    // other field stays editable while locked — only the name can probe.
    const scope = await privacyScope();
    if (scope.enabled && !scope.unlocked) {
      return fieldError("name", "Unlock to rename a place.");
    }

    // Both indexes are asked, because the alias table is derived from the
    // Location table rather than authoritative over it: a row whose canonical
    // claim is missing — an import, a half-applied fix, a process straddling
    // the upgrade — is invisible to the alias lookup, and the rename then
    // reaches the Location unique key as a raw constraint error rather than
    // as something the form can show. resolveLocation already falls back this
    // way for the same reason.
    const [named, claimed] = await Promise.all([
      prisma.location.findUnique({
        where: { ownerId_normalizedName: { ownerId, normalizedName } },
        select: { id: true },
      }),
      prisma.locationAlias.findUnique({
        where: {
          ownerId_normalizedValue: { ownerId, normalizedValue: normalizedName },
        },
        select: { locationId: true },
      }),
    ]);
    // Never merge on a name collision. Two real venues can be spelled alike,
    // and folding one into the other would take a history with it.
    if ((named && named.id !== id) || (claimed && claimed.locationId !== id)) {
      return fieldError(
        "name",
        "You already have a different place with that name.",
      );
    }
  }

  // Changing the aliases is refused while locked, for the reason the rename
  // above is: the collision check below asks the same question of the whole
  // account, hidden places included. Keeping the canonical name unchanged
  // walked straight past the rename guard, and then a guessed alias came back
  // as "Another place already uses that name or alias" while a free one saved
  // — the same oracle by a different field. Only a *change* is refused, so
  // every other edit still saves with the aliases the form resubmits.
  const submitted = new Set(aliases.map((alias) => alias.normalizedValue));
  const stored = new Set(
    existing.locationAliases
      .filter((alias) => !alias.isCanonical)
      .map((alias) => alias.normalizedValue),
  );
  const aliasesChanged =
    submitted.size !== stored.size ||
    [...submitted].some((value) => !stored.has(value));
  if (aliasesChanged) {
    const scope = await privacyScope();
    if (scope.enabled && !scope.unlocked)
      return fieldError("aliases", "Unlock to change a place's other names.");
  }

  const claims = [
    normalizedName,
    ...aliases.map((alias) => alias.normalizedValue),
  ];
  const conflictingAlias = await prisma.locationAlias.findFirst({
    where: {
      ownerId,
      normalizedValue: { in: claims },
      locationId: { not: id },
    },
    select: { id: true },
  });
  if (conflictingAlias)
    return fieldError(
      "aliases",
      "Another place already uses that name or alias.",
    );

  // A lookup the user accepted rides along with the save rather than writing on
  // its own. Accepting used to submit only the candidate and close the panel,
  // which silently threw away any name, phone or note typed beforehand.
  let identity: LocationIdentity = {};
  if (str(form, "lookupApplied")) {
    const lookup = lookupSchema.safeParse({
      latitude: str(form, "latitude"),
      longitude: str(form, "longitude"),
      osmType: str(form, "osmType"),
      osmId: str(form, "osmId"),
    });
    if (!lookup.success) return fail("That result didn't look like a place.");
    identity = identityFrom(lookup.data);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.location.update({
        where: { id },
        data: {
          name,
          normalizedName,
          address: parsed.data.address ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          country: parsed.data.country ?? null,
          phone: parsed.data.phone ?? null,
          url: parsed.data.url ?? null,
          notes: parsed.data.notes ?? null,
          ...identity,
        },
      });
      await tx.locationAlias.deleteMany({ where: { ownerId, locationId: id } });
      await tx.locationAlias.createMany({
        data: [
          {
            ownerId,
            locationId: id,
            value: name,
            normalizedValue: normalizedName,
            isCanonical: true,
          },
          ...aliases.map((alias) => ({
            ownerId,
            locationId: id,
            ...alias,
            isCanonical: false,
          })),
        ],
      });
    });
  } catch (error) {
    // `indexKey` reads utf8mb4_unicode_ci rather than being it, so a rule it
    // does not reproduce would surface as an unhandled constraint error that
    // rolls back an otherwise ordinary edit with nothing shown on the form.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return fieldError(
        "aliases",
        "Two of those names count as the same one. Keep whichever you prefer.",
      );
    throw error;
  }

  touch(id);
  return ok();
}

interface LocationIdentity {
  latitude?: string | number | null;
  longitude?: string | number | null;
  osmType?: string | null;
  osmId?: bigint | null;
}

/**
 * Which real-world object this place is, as one unit.
 *
 * Replaced wholesale and nulled where the accepted candidate is silent. Left
 * partially in place, a coarser second choice could keep the previous OSM
 * object and coordinates while the address described the new one — and
 * `mapLinkFor` prefers identity, so the map opened what you had just replaced.
 */
function identityFrom(data: {
  latitude?: number;
  longitude?: number;
  osmType?: "N" | "W" | "R";
  osmId?: string;
}): LocationIdentity {
  // Half a pair puts a place in the wrong hemisphere rather than nowhere.
  const bothCoordinates =
    data.latitude !== undefined && data.longitude !== undefined;
  return {
    latitude: bothCoordinates ? data.latitude : null,
    longitude: bothCoordinates ? data.longitude : null,
    osmType: data.osmType ?? null,
    osmId: data.osmId === undefined ? null : BigInt(data.osmId),
  };
}

/**
 * Ask the configured endpoint about an address. Writes nothing.
 *
 * Pressed deliberately, never on a page load and never while typing — both
 * because an address should not leave the machine as a side effect of browsing,
 * and because Nominatim's usage policy forbids search-as-you-type outright.
 *
 * Only the place's name and whatever address the user typed are sent. Never the
 * notes, never who was seen there, never anything about an interaction.
 */
export async function lookupLocationAddress(
  form: FormData,
): Promise<ActionResult<{ candidates: GeoCandidateView[] }>> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Which place?");
  if (!(await visibleLocation(ownerId, id)))
    return fail("That place wasn't found.");

  const query = str(form, "query");
  if (!query) return fail("Type an address or a place name to look up.");

  // The whole directory is optional, so it is loaded behind a dynamic import
  // and every failure falls back to "found nothing" rather than an error.
  try {
    const { lookupAvailable, currentGeoConfig } =
      await import("@/server/geo/config");
    if (!(await lookupAvailable())) {
      return fail("Address lookup is switched off. Turn it on in Settings.");
    }
    const config = await currentGeoConfig();
    if (!config) return fail("Address lookup isn't configured.");

    const { searchAddress } = await import("@/server/geo/providers");
    const candidates = await searchAddress(config, query);
    return ok({
      candidates: candidates.map((candidate) => ({
        label: candidate.label,
        address: candidate.address,
        city: candidate.city,
        region: candidate.region,
        country: candidate.country,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        osmType: candidate.osmType,
        osmId: candidate.osmId,
      })),
    });
  } catch {
    return fail(
      "That lookup didn't work. You can still fill the address in by hand.",
    );
  }
}

export interface GeoCandidateView {
  label: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  osmType: "N" | "W" | "R" | null;
  osmId: string | null;
}

export async function setLocationArchived(
  form: FormData,
): Promise<ActionResult> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Which place?");
  if (!(await visibleLocation(ownerId, id)))
    return fail("That place wasn't found.");

  // Archiving only sets a flag. Interactions keep their `locationId` and their
  // verbatim labels, so the history is intact and the change is reversible.
  await prisma.location.update({
    where: { id },
    data: { isArchived: str(form, "archived") !== "false" },
  });

  touch(id);
  return ok();
}
