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
  const existing = await tx.location.findUnique({
    where: { ownerId_normalizedName: { ownerId, normalizedName } },
    select: { id: true, name: true },
  });
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
    data: { ownerId, name, normalizedName, address: details.address, url: details.url },
    select: { id: true, name: true },
  });
}
