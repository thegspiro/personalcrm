import "server-only";
import { prisma } from "@/server/db/client";
import { redactChannel, type RedactedChannel } from "@/server/notifications/config";

/**
 * The channels on an account, as the settings page may see them.
 *
 * Everything goes through `redactChannel`, so no stored credential can reach
 * the browser by way of a field somebody forgot to strip.
 */
export async function listChannelsForSettings(ownerId: string): Promise<RedactedChannel[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(redactChannel);
}
