import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { plainDateFromDb, plainDateKey, plainDateToDb, todayInTz, type PlainDate } from "@/lib/dates";
import { dueOccurrence, effectiveReminderDays } from "@/lib/reminders";
import { deliverToChannel } from "./notify";

const MAX_ATTEMPTS = 5;

/**
 * Identifies one occurrence independently of the channel it was sent to.
 *
 * Both sides go through `plainDateKey` so a `@db.Date` read back as a Date and
 * a computed `PlainDate` cannot format differently — the set would silently
 * never match, and the failure would look like the guard simply not working.
 */
function orphanKey(entityId: string, occurrence: PlainDate, offset: number): string {
  return `${entityId}|${plainDateKey(occurrence)}|${offset}`;
}

/**
 * Creates one durable attempt per occurrence/offset/channel before delivery.
 * A concurrent scheduler loses the unique-key race and therefore cannot send
 * the same reminder twice. Failed attempts are retried with exponential delay.
 */
export async function processImportantDateReminders(
  now = new Date(),
  dependencies: { db?: typeof prisma; send?: typeof deliverToChannel } = {},
): Promise<{ sent: number; failed: number }> {
  const db = dependencies.db ?? prisma;
  const send = dependencies.send ?? deliverToChannel;
  let sent = 0;
  let failed = 0;
  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      preference: { select: { timezone: true, privacyLockEnabled: true } },
      notificationChannels: { where: { isEnabled: true } },
    },
  });

  for (const user of users) {
    if (user.notificationChannels.length === 0) continue;
    const timezone = user.preference?.timezone ?? "America/New_York";
    const today = todayInTz(timezone, now);
    const dates = await db.importantDate.findMany({
      where: {
        ownerId: user.id,
        contact: {
          isArchived: false,
          ...(user.preference?.privacyLockEnabled ? { isPrivate: false } : {}),
        },
      },
      include: { contact: { select: { firstName: true, lastName: true } } },
    });

    // An occurrence already delivered through a channel that has since been
    // deleted must not go out again. `ReminderLog.channelId` is SET NULL, so the
    // ledger keeps the record but loses the id — and the uniqueness key includes
    // that id, so a replacement channel gets a fresh key and the insert below
    // succeeds where it should collide. Deleting and recreating a channel inside
    // one due window is the path that replays an already-sent reminder; the
    // orphaned row is what proves it was sent. Gathered once per account rather
    // than per date, because the common case is that there are none.
    const orphaned = await db.reminderLog.findMany({
      where: {
        ownerId: user.id,
        entityType: "IMPORTANT_DATE",
        channelId: null,
        ok: true,
        // Bounded to what could still come due. Without this the scan grows
        // with the account's whole delivery history, for a check that only ever
        // concerns occurrences at or ahead of today.
        scheduledFor: { gte: plainDateToDb(today) },
      },
      select: { entityId: true, scheduledFor: true, offsetDays: true },
    });
    const deliveredToARemovedChannel = new Set(
      orphaned.map((row) =>
        orphanKey(row.entityId, plainDateFromDb(row.scheduledFor), row.offsetDays),
      ),
    );

    for (const date of dates) {
      const policy = Array.isArray(date.reminderDaysBefore) ? date.reminderDaysBefore as number[] : null;
      for (const offset of effectiveReminderDays(policy)) {
        const occurrence = dueOccurrence(plainDateFromDb(date.date), date.recurrence, today, offset);
        if (!occurrence) continue;
        if (deliveredToARemovedChannel.has(orphanKey(date.id, occurrence, offset))) continue;

        for (const channel of user.notificationChannels) {
          let log;
          try {
            log = await db.reminderLog.create({
              data: {
                ownerId: user.id,
                entityType: "IMPORTANT_DATE",
                entityId: date.id,
                scheduledFor: plainDateToDb(occurrence),
                offsetDays: offset,
                channelId: channel.id,
              },
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
            throw error;
          }
          const person = [date.contact.firstName, date.contact.lastName].filter(Boolean).join(" ");
          const subject = `Reminder: ${date.label}`;
          const when =
            offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`;
          const body = `${date.label} for ${person} is ${when} (${plainDateKey(occurrence)}).`;
          try {
            await send(channel, subject, body);
            await db.reminderLog.update({ where: { id: log.id }, data: { ok: true, sentAt: now, attemptCount: 1 } });
            sent += 1;
          } catch (error) {
            await db.reminderLog.update({ where: { id: log.id }, data: {
              attemptCount: 1,
              error: error instanceof Error ? error.message : "Delivery failed.",
              nextAttemptAt: new Date(now.getTime() + 60_000),
            } });
            failed += 1;
          }
        }
      }
    }
  }

  const retries = await db.reminderLog.findMany({
    where: { ok: false, channelId: { not: null }, attemptCount: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now }, channel: { isEnabled: true } },
    include: { channel: true },
  });
  for (const log of retries) {
    if (!log.channel) continue;
    const current = await db.importantDate.findFirst({
      where: { id: log.entityId, ownerId: log.ownerId },
      select: {
        reminderDaysBefore: true,
        contact: { select: { isArchived: true, isPrivate: true } },
        owner: { select: { preference: { select: { privacyLockEnabled: true } } } },
      },
    });
    const currentPolicy = current && (Array.isArray(current.reminderDaysBefore) ? current.reminderDaysBefore as number[] : null);
    if (!current || current.contact.isArchived ||
      (current.contact.isPrivate && current.owner.preference?.privacyLockEnabled) ||
      !effectiveReminderDays(currentPolicy).includes(log.offsetDays)) {
      // Policy/privacy changes cancel queued delivery rather than leaking stale content.
      await db.reminderLog.update({ where: { id: log.id }, data: { nextAttemptAt: null, error: "Delivery cancelled by current policy." } });
      continue;
    }
    try {
      await send(log.channel, "Personal CRM reminder retry", `A reminder scheduled for ${log.scheduledFor.toISOString().slice(0, 10)} is due.`);
      await db.reminderLog.update({ where: { id: log.id }, data: { ok: true, sentAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, error: null } });
      sent += 1;
    } catch (error) {
      const attempt = log.attemptCount + 1;
      await db.reminderLog.update({ where: { id: log.id }, data: {
        attemptCount: attempt,
        error: error instanceof Error ? error.message : "Delivery failed.",
        nextAttemptAt: attempt < MAX_ATTEMPTS ? new Date(now.getTime() + 60_000 * 2 ** (attempt - 1)) : null,
      } });
      failed += 1;
    }
  }
  return { sent, failed };
}
