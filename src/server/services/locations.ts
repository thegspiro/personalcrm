import type { Prisma } from "@prisma/client";
import { normalizeLocationName } from "@/lib/locations";

/** Resolve untrusted location input without ever crossing the authenticated owner boundary. */
export async function resolveLocation(
  tx: Prisma.TransactionClient,
  ownerId: string,
  locationId: string | undefined,
  submittedName: string | undefined,
): Promise<{ id: string; displayName: string } | null | undefined> {
  if (locationId) {
    return (await tx.location.findFirst({
      where: { id: locationId, ownerId },
      select: { id: true, displayName: true },
    })) ?? undefined;
  }
  if (!submittedName?.trim()) return null;
  const displayName = submittedName.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeLocationName(displayName);
  return tx.location.upsert({
    where: { ownerId_normalizedName: { ownerId, normalizedName } },
    create: { ownerId, displayName, normalizedName },
    update: {},
    select: { id: true, displayName: true },
  });
}
