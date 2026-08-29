import "server-only";
import { Prisma, type NotificationChannel } from "@prisma/client";
import nodemailer from "nodemailer";
import { prisma } from "@/server/db/client";
import { plainDateFromDb, plainDateKey, plainDateToDb, todayInTz } from "@/lib/dates";
import { dueOccurrence, effectiveReminderDays } from "@/lib/reminders";

const MAX_ATTEMPTS = 5;

type ChannelConfig = Record<string, unknown>;

function configOf(channel: NotificationChannel): ChannelConfig {
  return typeof channel.config === "object" && channel.config && !Array.isArray(channel.config)
    ? channel.config as ChannelConfig
    : {};
}

async function deliver(channel: NotificationChannel, subject: string, body: string): Promise<void> {
  const config = configOf(channel);
  if (channel.kind === "EMAIL") {
    if (typeof config.host !== "string" || typeof config.to !== "string" || typeof config.from !== "string") {
      throw new Error("Email channel requires host, from, and to.");
    }
    const transport = nodemailer.createTransport({
      host: config.host,
      port: typeof config.port === "number" ? config.port : 587,
      secure: config.secure === true,
      auth: typeof config.user === "string" && typeof config.pass === "string"
        ? { user: config.user, pass: config.pass }
        : undefined,
    });
    await transport.sendMail({ from: config.from, to: config.to, subject, text: body });
    return;
  }

  const url = typeof config.url === "string" ? config.url : null;
  if (!url) throw new Error(`${channel.kind} channel requires a URL.`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (typeof config.token === "string") headers.authorization = `Bearer ${config.token}`;
  const payload = channel.kind === "DISCORD" ? { content: `${subject}\n${body}` } : { title: subject, message: body };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Channel returned HTTP ${response.status}.`);
}

/**
 * Creates one durable attempt per occurrence/offset/channel before delivery.
 * A concurrent scheduler loses the unique-key race and therefore cannot send
 * the same reminder twice. Failed attempts are retried with exponential delay.
 */
export async function processImportantDateReminders(
  now = new Date(),
  dependencies: { db?: typeof prisma; send?: typeof deliver } = {},
): Promise<{ sent: number; failed: number }> {
  const db = dependencies.db ?? prisma;
  const send = dependencies.send ?? deliver;
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

    for (const date of dates) {
      const policy = Array.isArray(date.reminderDaysBefore) ? date.reminderDaysBefore as number[] : null;
      for (const offset of effectiveReminderDays(policy)) {
        const occurrence = dueOccurrence(plainDateFromDb(date.date), date.recurrence, today, offset);
        if (!occurrence) continue;
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
          const body = `${date.label} for ${person} is ${offset === 0 ? "today" : `in ${offset} days`} (${plainDateKey(occurrence)}).`;
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
