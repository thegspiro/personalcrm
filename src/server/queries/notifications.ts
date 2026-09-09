import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { redactChannel, type RedactedChannel } from "@/server/notifications/config";
import { MAX_DELIVERY_ATTEMPTS, type ChannelHealth } from "@/lib/channel-health";

export type SettingsChannel = RedactedChannel & { health: ChannelHealth };

/**
 * Rows the scheduler gave up on, since the channel last delivered anything.
 *
 * A row is abandoned rather than merely waiting when it has no next attempt
 * *and* has used every one it was given. Cancelling has the same empty
 * `nextAttemptAt` and is not a failure at all — a completed task, a contact
 * made private — so the attempt count is what tells them apart; the scheduler
 * puts cancelled rows back on the retry path when they become due again, and
 * counting those as failures would report a working channel as broken.
 *
 * Counted since the last success so the number answers "is it broken now"
 * rather than "has it ever been broken". One delivery getting through resets
 * it to zero, which is also what lifts a pause.
 */
function abandonedSince(channelId: string, since: Date | null) {
  return {
    channelId,
    ok: false,
    nextAttemptAt: null,
    attemptCount: { gte: MAX_DELIVERY_ATTEMPTS },
    ...(since ? { lastAttemptAt: { gt: since } } : {}),
  };
}

/**
 * Whether a channel is delivering, read from the ledger rather than stored on
 * the channel.
 *
 * Derived on purpose: a counter on the row would have to be maintained by
 * every path that sends, and the one that forgot would report a dead channel as
 * healthy — the exact failure this exists to end.
 *
 * Nothing here is filtered by the privacy lock, and nothing needs to be: the
 * numbers are counts of *deliveries*, the strings are transport errors, and no
 * field names a person. They do not shift when the lock opens, so there is no
 * total for an observer to read a private row out of.
 */
export async function channelHealth(channel: NotificationChannel): Promise<ChannelHealth> {
  const lastOk = await prisma.reminderLog.findFirst({
    where: { channelId: channel.id, ok: true, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  const lastFailure = await prisma.reminderLog.findFirst({
    where: { channelId: channel.id, ok: false, error: { not: null }, lastAttemptAt: { not: null } },
    orderBy: { lastAttemptAt: "desc" },
    select: { lastAttemptAt: true, error: true },
  });
  const abandoned = await prisma.reminderLog.count({
    where: abandonedSince(channel.id, lastOk?.sentAt ?? null),
  });

  return {
    lastOkAt: lastOk?.sentAt?.toISOString() ?? null,
    lastFailureAt: lastFailure?.lastAttemptAt?.toISOString() ?? null,
    lastError: lastFailure?.error ?? null,
    abandoned,
    pausedAt: channel.pausedAt?.toISOString() ?? null,
    pauseReason: channel.pauseReason,
  };
}

/**
 * The channels on an account, as the settings page may see them.
 *
 * Everything goes through `redactChannel`, so no stored credential can reach
 * the browser by way of a field somebody forgot to strip.
 */
export async function listChannelsForSettings(ownerId: string): Promise<SettingsChannel[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: "asc" }],
  });
  return Promise.all(
    rows.map(async (row) => ({ ...redactChannel(row), health: await channelHealth(row) })),
  );
}
