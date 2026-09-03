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
  const existingAlias = await tx.locationAlias.findUnique({
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
  });
  const claimed = existingAlias?.location ?? null;
  const usable = claimed?.ownerId === ownerId;
  let existing: { id: string; name: string } | null =
    claimed && usable ? { id: claimed.id, name: claimed.name } : null;
  // The key is claimed in our own namespace but points somewhere we cannot
  // use, so every write below has to re-point that row rather than insert
  // beside it — the unique index would refuse a second one, and a raw
  // constraint error out of `resolveLocation` reaches the caller as a failed
  // save with nothing to show for it. Claiming it is the repair: the row is
  // ours, and where it points is the part that is wrong.
  const claimIsStale = Boolean(claimed) && !usable;
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
  // Repair a missing canonical claim for callers that inserted Location
  // directly (and for a process straddling an upgrade deployment).
  if (!existing) {
    existing = await tx.location.findUnique({
      where: { ownerId_normalizedName: { ownerId, normalizedName } },
      select: { id: true, name: true },
    });
    if (existing) await claimCanonical(existing.id, existing.name);
  }
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
