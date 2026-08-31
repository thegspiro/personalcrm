"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { normalizeLocationName } from "@/lib/locations";
import { locationVisibleWhere } from "@/server/queries/locations";
import { privacyScope } from "@/server/privacy/filter";
import { type ActionResult, fail, fieldError, invalid, ok, owner, str } from "./helpers";

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

const schema = z.object({
  name: z.string().trim().min(1, "Give the place a name.").max(191),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(64).optional(),
  url: z.string().trim().url("That isn't a valid link.").max(500).optional(),
  notes: z.string().trim().optional(),
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
    select: { id: true, normalizedName: true },
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
  });
  if (!parsed.success) return invalid(parsed.error);

  const name = parsed.data.name.replace(/\s+/g, " ");
  const normalizedName = normalizeLocationName(name);

  if (normalizedName !== existing.normalizedName) {
    const clash = await prisma.location.findUnique({
      where: { ownerId_normalizedName: { ownerId, normalizedName } },
      select: { id: true },
    });
    // Never merge on a name collision. Two real venues can be spelled alike,
    // and folding one into the other would take a history with it.
    if (clash && clash.id !== id) {
      return fieldError("name", "You already have a different place with that name.");
    }
  }

  await prisma.location.update({
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
    },
  });

  touch(id);
  return ok();
}

/**
 * Attach the OpenStreetMap object a lookup matched, plus what it knew.
 *
 * Split from `updateLocation` because it is the only writer of the reference
 * fields, and because it takes what the user picked from a list of candidates
 * rather than free text.
 */
export async function applyLocationLookup(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Which place?");
  if (!(await visibleLocation(ownerId, id))) return fail("That place wasn't found.");

  const osmType = str(form, "osmType");
  if (osmType && !["N", "W", "R"].includes(osmType)) return fail("That result looks wrong.");

  const coordinate = (key: string) => {
    const raw = str(form, key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? raw : null;
  };

  // OSM ids are past 2^32 and still climbing, so the column is a BIGINT and the
  // posted digits have to become one rather than a float that loses precision.
  const rawOsmId = str(form, "osmId");
  let osmId: bigint | undefined;
  if (rawOsmId !== undefined) {
    if (!/^\d+$/.test(rawOsmId)) return fail("That result looks wrong.");
    osmId = BigInt(rawOsmId);
  }

  const latitude = coordinate("latitude");
  const longitude = coordinate("longitude");
  // Half a pair puts a place in the wrong hemisphere rather than nowhere.
  const bothCoordinates = latitude !== null && longitude !== null;

  await prisma.location.update({
    where: { id },
    data: {
      address: str(form, "address") ?? undefined,
      city: str(form, "city") ?? undefined,
      region: str(form, "region") ?? undefined,
      country: str(form, "country") ?? undefined,
      latitude: bothCoordinates ? latitude : undefined,
      longitude: bothCoordinates ? longitude : undefined,
      osmType: osmType ?? undefined,
      osmId,
    },
  });

  touch(id);
  return ok();
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
  if (!(await visibleLocation(ownerId, id))) return fail("That place wasn't found.");

  const query = str(form, "query");
  if (!query) return fail("Type an address or a place name to look up.");

  // The whole directory is optional, so it is loaded behind a dynamic import
  // and every failure falls back to "found nothing" rather than an error.
  try {
    const { lookupAvailable, currentGeoConfig } = await import("@/server/geo/config");
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
    return fail("That lookup didn't work. You can still fill the address in by hand.");
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

export async function setLocationArchived(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Which place?");
  if (!(await visibleLocation(ownerId, id))) return fail("That place wasn't found.");

  // Archiving only sets a flag. Interactions keep their `locationId` and their
  // verbatim labels, so the history is intact and the change is reversible.
  await prisma.location.update({
    where: { id },
    data: { isArchived: str(form, "archived") !== "false" },
  });

  touch(id);
  return ok();
}
