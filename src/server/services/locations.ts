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
    select: { location: { select: { id: true, name: true } } },
  });
  let existing: { id: string; name: string } | null = existingAlias?.location ?? null;
  // Repair a missing canonical claim for callers that inserted Location
  // directly (and for a process straddling an upgrade deployment).
  if (!existing) {
    existing = await tx.location.findUnique({
      where: { ownerId_normalizedName: { ownerId, normalizedName } },
      select: { id: true, name: true },
    });
    if (existing) {
      await tx.locationAlias.create({
        data: {
          ownerId,
          locationId: existing.id,
          value: existing.name,
          normalizedValue: normalizedName,
          isCanonical: true,
        },
      });
    }
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
  return tx.location.create({
    data: {
      ownerId,
      name,
      normalizedName,
      address: details.address,
      url: details.url,
      locationAliases: {
        create: {
          ownerId,
          value: name,
          normalizedValue: normalizedName,
          isCanonical: true,
        },
      },
    },
    select: { id: true, name: true },
  });
}
