import type { Prisma } from "@prisma/client";
import { normalizeLocationName } from "@/lib/locations";

// The normalizer lives in `src/lib/` so the pure quick-add parser and the
// timeline post-filter can share it. Re-exported here because this module is
// where every write path already looks for it.
export { normalizeLocationName };

export async function resolveLocation(
  tx: Prisma.TransactionClient,
  ownerId: string,
  rawName: string | undefined,
  details: { address?: string | null; url?: string | null } = {},
): Promise<{ id: string; name: string } | null> {
  const name = rawName?.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const normalizedName = normalizeLocationName(name);
  const [canonical, existingAlias] = await Promise.all([
    // The canonical namespace is asked first, and its answer wins.
    //
    // A place's own name outranks another place's nickname for it. Asking the
    // alias index first, an account holding a location whose canonical claim
    // is missing — an import, a restore, a repair, or an upgrade caught
    // mid-deployment — while some *other* location carried an alias spelt the
    // same, resolved that name to the other place and never reached the
    // fallback below. Every interaction entered with the real name was filed
    // against the wrong location, and any address or URL typed with it
    // overwrote that location's own.
    tx.location.findUnique({
      where: { ownerId_normalizedName: { ownerId, normalizedName } },
      select: { id: true, name: true },
    }),
    tx.locationAlias.findUnique({
      where: {
        ownerId_normalizedValue: { ownerId, normalizedValue: normalizedName },
      },
      // The alias's own ownerId and its location's are two independent foreign
      // keys, so an imported, restored or hand-repaired row can carry one
      // account's alias against another account's place. Accepting it on the
      // alias's owner alone would hand back that foreign location — and this
      // function then attaches interactions to it, and writes `details` onto
      // its address and URL. The location has to be ours too.
      select: { location: { select: { id: true, name: true, ownerId: true } } },
    }),
  ]);
  const claimed = existingAlias?.location ?? null;
  const usable = claimed?.ownerId === ownerId;
  let existing: { id: string; name: string } | null =
    canonical ?? (claimed && usable ? { id: claimed.id, name: claimed.name } : null);
  // The key is claimed in our own namespace but points somewhere this name
  // does not belong — another account's place, or one of ours that is not the
  // place actually called this. Every write below has to re-point that row
  // rather than insert beside it: the unique index would refuse a second one,
  // and a raw constraint error out of `resolveLocation` reaches the caller as
  // a failed save with nothing to show for it. Claiming it is the repair; the
  // row is ours, and where it points is the part that is wrong.
  const claimIsStale =
    claimed !== null && (!usable || (canonical !== null && claimed.id !== canonical.id));
  const claimCanonical = async (locationId: string, value: string) => {
    if (claimIsStale) {
      await tx.locationAlias.update({
        where: {
          ownerId_normalizedValue: { ownerId, normalizedValue: normalizedName },
        },
        data: { locationId, value, isCanonical: true },
      });
      return;
    }
    await tx.locationAlias.create({
      data: {
        ownerId,
        locationId,
        value,
        normalizedValue: normalizedName,
        isCanonical: true,
      },
    });
  };
  // Repair the claim for callers that inserted Location directly, for a
  // process straddling an upgrade deployment, and for the conflict above —
  // where the row exists and points at the wrong place, so it is re-pointed
  // rather than left to mislead the next lookup as well.
  if (canonical && (claimIsStale || !claimed))
    await claimCanonical(canonical.id, canonical.name);
  if (existing) {
    if (details.address || details.url) {
      await tx.location.update({
        where: { id: existing.id },
        data: {
          ...(details.address ? { address: details.address } : {}),
          ...(details.url ? { url: details.url } : {}),
        },
      });
    }
    return existing;
  }
  const created = await tx.location.create({
    data: {
      ownerId,
      name,
      normalizedName,
      address: details.address,
      url: details.url,
    },
    select: { id: true, name: true },
  });
  await claimCanonical(created.id, created.name);
  return created;
}
