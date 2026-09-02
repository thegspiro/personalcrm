import "server-only";
import { Prisma, type ReminderEntity } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { calendarDateInTz, plainDateFromDb, plainDateKey, plainDateToDb, todayInTz } from "@/lib/dates";
import { dueOccurrence, effectiveReminderDays } from "@/lib/reminders";
import { dailyOccurrence, digestIsDue, reminderDedupKey, type SchedulingPolicy } from "@/lib/reminder-schedule";
import { deliverToChannel } from "./notify";

const MAX_ATTEMPTS = 5;
type Db = typeof prisma;
type Channel = Awaited<ReturnType<Db["notificationChannel"]["findFirstOrThrow"]>>;
type Candidate = {
  entityType: ReminderEntity;
  entityId: string;
  policy: SchedulingPolicy;
  occurrence: string;
  scheduledFor: Date;
  offsetDays: number;
  subject: string;
  body: string;
};

type UserSchedule = {
  id: string;
  preference: { timezone: string; privacyLockEnabled: boolean; digestEnabled: boolean; digestHour: number } | null;
  notificationChannels: Channel[];
};

function visibleContact(privacyLockEnabled: boolean) {
  return { isArchived: false, ...(privacyLockEnabled ? { isPrivate: false } : {}) };
}

async function candidatesForUser(db: Db, user: UserSchedule, now: Date): Promise<Candidate[]> {
  const timezone = user.preference?.timezone ?? "America/New_York";
  const locked = user.preference?.privacyLockEnabled ?? false;
  const today = todayInTz(timezone, now);
  const candidates: Candidate[] = [];

  const dates = await db.importantDate.findMany({
    where: { ownerId: user.id, contact: visibleContact(locked) },
    include: { contact: { select: { firstName: true, lastName: true } } },
  });
  for (const date of dates) {
    const configured = Array.isArray(date.reminderDaysBefore) ? date.reminderDaysBefore as number[] : null;
    for (const offset of effectiveReminderDays(configured)) {
      const occurrence = dueOccurrence(plainDateFromDb(date.date), date.recurrence, today, offset);
      if (!occurrence) continue;
      const person = [date.contact.firstName, date.contact.lastName].filter(Boolean).join(" ");
      candidates.push({ entityType: "IMPORTANT_DATE", entityId: date.id, policy: "IMPORTANT_DATE_OFFSET",
        occurrence: plainDateKey(occurrence), scheduledFor: plainDateToDb(occurrence), offsetDays: offset,
        subject: `Reminder: ${date.label}`,
        body: `${date.label} for ${person} is ${offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`} (${plainDateKey(occurrence)}).` });
    }
  }

  const cadence = await db.contact.findMany({
    where: { ownerId: user.id, ...visibleContact(locked), nextTouchAt: { lte: now } },
    select: { id: true, firstName: true, lastName: true, nextTouchAt: true },
  });
  for (const contact of cadence) {
    if (!contact.nextTouchAt) continue;
    const person = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    const due = plainDateKey(calendarDateInTz(contact.nextTouchAt, timezone));
    candidates.push({ entityType: "CADENCE", entityId: contact.id, policy: "OVERDUE_CADENCE",
      occurrence: contact.nextTouchAt.toISOString(), scheduledFor: plainDateToDb(calendarDateInTz(contact.nextTouchAt, timezone)), offsetDays: 0,
      subject: `Time to reach out to ${person}`, body: `${person}'s keep-in-touch cadence has been due since ${due}.` });
  }

  const tasks = await db.task.findMany({
    where: { ownerId: user.id, completedAt: null, dueDate: { lte: plainDateToDb(today) },
      OR: [{ contactId: null }, { contact: visibleContact(locked) }] },
    include: { contact: { select: { firstName: true, lastName: true } } },
  });
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const due = plainDateKey(plainDateFromDb(task.dueDate));
    const person = task.contact && [task.contact.firstName, task.contact.lastName].filter(Boolean).join(" ");
    candidates.push({ entityType: "TASK", entityId: task.id, policy: "INCOMPLETE_TASK_DUE",
      occurrence: due, scheduledFor: task.dueDate, offsetDays: 0, subject: `Task due: ${task.title}`,
      body: `${task.title}${person ? ` for ${person}` : ""} was due ${due}.` });
  }

  if (user.preference?.digestEnabled && digestIsDue(now, timezone, user.preference.digestHour)) {
    const occurrence = dailyOccurrence(now, timezone);
    candidates.push({ entityType: "DIGEST", entityId: user.id, policy: "DAILY_DIGEST", occurrence,
      scheduledFor: plainDateToDb(today), offsetDays: 0, subject: "Your Personal CRM daily digest",
      body: `${cadence.length} cadence reminder${cadence.length === 1 ? "" : "s"} and ${tasks.length} due task${tasks.length === 1 ? "" : "s"} need attention today.` });
  }
  return candidates;
}

async function createAndDeliver(db: Db, send: typeof deliverToChannel, user: UserSchedule, candidate: Candidate, channel: Channel, now: Date) {
  const dedupKey = reminderDedupKey({ ownerId: user.id, entityType: candidate.entityType, entityId: candidate.entityId,
    policy: candidate.policy, occurrence: candidate.occurrence, offsetDays: candidate.offsetDays, channelId: channel.id });
  let log;
  try {
    log = await db.reminderLog.create({ data: { ownerId: user.id, entityType: candidate.entityType,
      entityId: candidate.entityId, schedulingPolicy: candidate.policy, dedupKey, scheduledFor: candidate.scheduledFor,
      offsetDays: candidate.offsetDays, channelId: channel.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
  try {
    await send(channel, candidate.subject, candidate.body);
    await db.reminderLog.update({ where: { id: log.id }, data: { ok: true, sentAt: now, attemptCount: 1 } });
    return true;
  } catch (error) {
    await db.reminderLog.update({ where: { id: log.id }, data: { attemptCount: 1,
      error: error instanceof Error ? error.message : "Delivery failed.", nextAttemptAt: new Date(now.getTime() + 60_000) } });
    return false;
  }
}

/** Runs all explicit policies and then revalidates queued failures against current owner/privacy state. */
export async function processReminderDeliveries(now = new Date(), dependencies: { db?: Db; send?: typeof deliverToChannel } = {}) {
  const db = dependencies.db ?? prisma;
  const send = dependencies.send ?? deliverToChannel;
  let sent = 0;
  let failed = 0;
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true,
    preference: { select: { timezone: true, privacyLockEnabled: true, digestEnabled: true, digestHour: true } },
    notificationChannels: { where: { isEnabled: true } } } });

  for (const user of users) {
    if (!user.notificationChannels.length) continue;
    for (const candidate of await candidatesForUser(db, user, now)) for (const channel of user.notificationChannels) {
      const result = await createAndDeliver(db, send, user, candidate, channel, now);
      if (result === true) sent += 1;
      if (result === false) failed += 1;
    }
  }

  const retries = await db.reminderLog.findMany({ where: { ok: false, channelId: { not: null }, attemptCount: { lt: MAX_ATTEMPTS },
    nextAttemptAt: { lte: now }, channel: { isEnabled: true } }, include: { channel: true } });
  for (const log of retries) {
    if (!log.channel) continue;
    const user = users.find((item) => item.id === log.ownerId);
    const current = user && (await candidatesForUser(db, user, now)).find((candidate) =>
      candidate.entityType === log.entityType && candidate.entityId === log.entityId &&
      candidate.policy === log.schedulingPolicy && candidate.offsetDays === log.offsetDays &&
      candidate.scheduledFor.getTime() === log.scheduledFor.getTime());
    if (!current) {
      await db.reminderLog.update({ where: { id: log.id }, data: { nextAttemptAt: null, error: "Delivery cancelled by current state, policy, or privacy." } });
      continue;
    }
    try {
      await send(log.channel, current.subject, current.body);
      await db.reminderLog.update({ where: { id: log.id }, data: { ok: true, sentAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, error: null } });
      sent += 1;
    } catch (error) {
      const attempt = log.attemptCount + 1;
      await db.reminderLog.update({ where: { id: log.id }, data: { attemptCount: attempt,
        error: error instanceof Error ? error.message : "Delivery failed.",
        nextAttemptAt: attempt < MAX_ATTEMPTS ? new Date(now.getTime() + 60_000 * 2 ** (attempt - 1)) : null } });
      failed += 1;
    }
  }
  return { sent, failed };
}

/** Backwards-compatible entry point for the hourly scheduler and existing callers. */
export const processImportantDateReminders = processReminderDeliveries;
