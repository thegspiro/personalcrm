import type { Prisma } from "@prisma/client";

/** Conservative identity: whitespace and case are safe; fuzzy matching is not. */
export function normalizeLocationName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

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
