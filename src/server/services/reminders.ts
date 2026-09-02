import "server-only";
import { Prisma, type ReminderEntity } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  addPlainDays,
  calendarDateInTz,
  endOfDayInTz,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  todayInTz,
  type PlainDate,
} from "@/lib/dates";
import { dueOccurrence, effectiveReminderDays, type ReminderPolicy } from "@/lib/reminders";
import {
  cadenceMessage,
  dailyOccurrence,
  digestIsDue,
  digestMessage,
  importantDateMessage,
  reminderDedupKey,
  taskMessage,
  type ReminderMessage,
  type SchedulingPolicy,
} from "@/lib/reminder-schedule";
import { deliverToChannel } from "./notify";

const MAX_ATTEMPTS = 5;
/** How long after a ledger row is written before a retry pass may claim it. */
const FIRST_RETRY_MS = 60_000;
const DEFAULT_TIMEZONE = "America/New_York";

/** A retry that is neither owed now nor cancelled: leave the row for a later pass. */
const NOT_YET = Symbol("not-yet");

type Db = typeof prisma;
type Channel = Awaited<ReturnType<Db["notificationChannel"]["findFirstOrThrow"]>>;

/** One thing owed to one owner on one occurrence; fanned out per channel. */
type Candidate = ReminderMessage & {
  entityType: ReminderEntity;
  entityId: string;
  policy: SchedulingPolicy;
  occurrence: string;
  scheduledFor: Date;
  offsetDays: number;
};

type UserSchedule = {
  id: string;
  preference: {
    timezone: string;
    privacyLockEnabled: boolean;
    digestEnabled: boolean;
    digestHour: number;
  } | null;
  notificationChannels: Channel[];
};

/** The owner's clock, as every policy sees it. */
type Schedule = { timezone: string; locked: boolean; today: PlainDate };

function scheduleFor(user: UserSchedule, now: Date): Schedule {
  const timezone = user.preference?.timezone ?? DEFAULT_TIMEZONE;
  return {
    timezone,
    locked: user.preference?.privacyLockEnabled ?? false,
    today: todayInTz(timezone, now),
  };
}

/** Archived people never get reminders; private ones only while the lock is off. */
function visibleContact(locked: boolean) {
  return { isArchived: false, ...(locked ? { isPrivate: false } : {}) };
}

function personName(contact: { firstName: string; lastName: string | null }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function reminderPolicy(stored: unknown): ReminderPolicy {
  return Array.isArray(stored) ? (stored as number[]) : null;
}

const CONTACT_NAME = { select: { firstName: true, lastName: true } } as const;

/**
 * A cadence is due for the whole of its local day, the way the overdue count,
 * the People filter and the contact card already read it — not from the
 * instant `nextTouchAt` happens to hold, which for someone last seen in the
 * evening would keep the reminder until that evening comes round.
 */
function cadenceWhere(user: UserSchedule, schedule: Schedule, now: Date) {
  return {
    ownerId: user.id,
    ...visibleContact(schedule.locked),
    nextTouchAt: { lte: endOfDayInTz(now, schedule.timezone) },
  };
}

function taskWhere(user: UserSchedule, schedule: Schedule) {
  return {
    ownerId: user.id,
    completedAt: null,
    dueDate: { lte: plainDateToDb(schedule.today) },
    OR: [{ contactId: null }, { contact: visibleContact(schedule.locked) }],
  };
}

async function candidatesForUser(db: Db, user: UserSchedule, now: Date): Promise<Candidate[]> {
  const schedule = scheduleFor(user, now);
  const candidates: Candidate[] = [];

  const dates = await db.importantDate.findMany({
    where: { ownerId: user.id, contact: visibleContact(schedule.locked) },
    include: { contact: CONTACT_NAME },
  });
  for (const date of dates) {
    for (const offset of effectiveReminderDays(reminderPolicy(date.reminderDaysBefore))) {
      const occurrence = dueOccurrence(plainDateFromDb(date.date), date.recurrence, schedule.today, offset);
      if (!occurrence) continue;
      candidates.push({
        entityType: "IMPORTANT_DATE",
        entityId: date.id,
        policy: "IMPORTANT_DATE_OFFSET",
        occurrence: plainDateKey(occurrence),
        scheduledFor: plainDateToDb(occurrence),
        offsetDays: offset,
        ...importantDateMessage(date.label, personName(date.contact), occurrence, schedule.today),
      });
    }
  }

  const cadence = await db.contact.findMany({
    where: cadenceWhere(user, schedule, now),
    select: { id: true, firstName: true, lastName: true, nextTouchAt: true },
  });
  for (const contact of cadence) {
    if (!contact.nextTouchAt) continue;
    const dueDay = calendarDateInTz(contact.nextTouchAt, schedule.timezone);
    candidates.push({
      entityType: "CADENCE",
      entityId: contact.id,
      policy: "OVERDUE_CADENCE",
      occurrence: contact.nextTouchAt.toISOString(),
      scheduledFor: plainDateToDb(dueDay),
      offsetDays: 0,
      ...cadenceMessage(personName(contact), dueDay),
    });
  }

  const tasks = await db.task.findMany({
    where: taskWhere(user, schedule),
    include: { contact: CONTACT_NAME },
  });
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const dueDay = plainDateFromDb(task.dueDate);
    candidates.push({
      entityType: "TASK",
      entityId: task.id,
      policy: "INCOMPLETE_TASK_DUE",
      occurrence: plainDateKey(dueDay),
      scheduledFor: plainDateToDb(dueDay),
      offsetDays: 0,
      ...taskMessage(task.title, task.contact ? personName(task.contact) : null, dueDay),
    });
  }

  if (user.preference?.digestEnabled && digestIsDue(now, schedule.timezone, user.preference.digestHour)) {
    candidates.push({
      entityType: "DIGEST",
      entityId: user.id,
      policy: "DAILY_DIGEST",
      occurrence: dailyOccurrence(now, schedule.timezone),
      scheduledFor: plainDateToDb(schedule.today),
      offsetDays: 0,
      ...digestMessage(cadence.length, tasks.length),
    });
  }
  return candidates;
}

/**
 * Whether a failed delivery is still owed, and what it should say now.
 *
 * Deliberately not "is it among today's candidates": a send that fails on the
 * last hourly pass of a day is first retried on the next day's, when the
 * occurrence is no longer due and would never match. Each policy instead
 * re-reads its own row and applies the same ownership, archive and privacy
 * rules it was created under, so a completed task, a corrected date, a
 * contact made private or a digest switched off cancels the retry — and
 * nothing else does.
 */
async function currentMessage(
  db: Db,
  user: UserSchedule,
  log: { entityId: string; schedulingPolicy: string; scheduledFor: Date; offsetDays: number },
  now: Date,
): Promise<ReminderMessage | null | typeof NOT_YET> {
  const schedule = scheduleFor(user, now);
  const scheduled = plainDateFromDb(log.scheduledFor);

  switch (log.schedulingPolicy as SchedulingPolicy) {
    case "IMPORTANT_DATE_OFFSET": {
      const date = await db.importantDate.findFirst({
        where: { id: log.entityId, ownerId: user.id, contact: visibleContact(schedule.locked) },
        include: { contact: CONTACT_NAME },
      });
      if (!date || !effectiveReminderDays(reminderPolicy(date.reminderDaysBefore)).includes(log.offsetDays)) {
        return null;
      }
      // The date may have been corrected since: it is still owed only if it
      // still falls on the occurrence this row was written for.
      const occurrence = dueOccurrence(
        plainDateFromDb(date.date),
        date.recurrence,
        addPlainDays(scheduled, -log.offsetDays),
        log.offsetDays,
      );
      if (!occurrence || plainDateKey(occurrence) !== plainDateKey(scheduled)) return null;
      return importantDateMessage(date.label, personName(date.contact), occurrence, schedule.today);
    }
    case "OVERDUE_CADENCE": {
      const contact = await db.contact.findFirst({
        where: { id: log.entityId, ownerId: user.id, ...visibleContact(schedule.locked) },
        select: { firstName: true, lastName: true, nextTouchAt: true },
      });
      if (!contact?.nextTouchAt) return null;
      // An interaction logged since moved the cadence on; that reminder is spent.
      const dueDay = calendarDateInTz(contact.nextTouchAt, schedule.timezone);
      if (plainDateKey(dueDay) !== plainDateKey(scheduled)) return null;
      return cadenceMessage(personName(contact), dueDay);
    }
    case "INCOMPLETE_TASK_DUE": {
      const task = await db.task.findFirst({
        where: {
          id: log.entityId,
          ownerId: user.id,
          completedAt: null,
          OR: [{ contactId: null }, { contact: visibleContact(schedule.locked) }],
        },
        include: { contact: CONTACT_NAME },
      });
      if (!task?.dueDate) return null;
      const dueDay = plainDateFromDb(task.dueDate);
      if (plainDateKey(dueDay) !== plainDateKey(scheduled)) return null;
      return taskMessage(task.title, task.contact ? personName(task.contact) : null, dueDay);
    }
    case "DAILY_DIGEST": {
      // A digest is that day's summary. Once the day has ended it is either
      // out of date or a copy of the one about to be sent, so it is dropped
      // rather than retried; within the day its counts are read afresh.
      if (!user.preference?.digestEnabled || plainDateKey(schedule.today) !== plainDateKey(scheduled)) {
        return null;
      }
      // The hour may have been moved later since the row was written. A fresh
      // candidate would wait for it; so does the retry, keeping its row and
      // its key rather than sending early or being cancelled outright.
      if (!digestIsDue(now, schedule.timezone, user.preference.digestHour)) return NOT_YET;
      const [cadence, tasks] = await Promise.all([
        db.contact.count({ where: cadenceWhere(user, schedule, now) }),
        db.task.count({ where: taskWhere(user, schedule) }),
      ]);
      return digestMessage(cadence, tasks);
    }
    default:
      return null;
  }
}

function dedupKeyFor(user: UserSchedule, candidate: Candidate, channel: Channel): string {
  return reminderDedupKey({
    ownerId: user.id,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    policy: candidate.policy,
    occurrence: candidate.occurrence,
    offsetDays: candidate.offsetDays,
    channelId: channel.id,
  });
}

/**
 * Creates one durable ledger row per candidate and channel before delivery.
 * A concurrent scheduler loses the unique-key race and therefore cannot send
 * the same reminder twice. Returns null when the row already existed.
 *
 * The row is written with its first retry deadline already set. Without it,
 * a process that died between this insert and the update after the send
 * would leave a row that is neither sent nor due for retry, and the unique
 * key would then stop the reminder being created ever again — lost in
 * exactly the restart the ledger exists to survive. Seeded, the same row is
 * picked up by the next retry pass, revalidated, and sent.
 */
async function createAndDeliver(
  db: Db,
  send: typeof deliverToChannel,
  user: UserSchedule,
  candidate: Candidate,
  channel: Channel,
  dedupKey: string,
  now: Date,
): Promise<boolean | null> {
  let log;
  try {
    log = await db.reminderLog.create({
      data: {
        ownerId: user.id,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        schedulingPolicy: candidate.policy,
        dedupKey,
        scheduledFor: candidate.scheduledFor,
        offsetDays: candidate.offsetDays,
        channelId: channel.id,
        nextAttemptAt: new Date(now.getTime() + FIRST_RETRY_MS),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
  try {
    await send(channel, candidate.subject, candidate.body);
    await db.reminderLog.update({
      where: { id: log.id },
      data: { ok: true, sentAt: now, attemptCount: 1, nextAttemptAt: null },
    });
    return true;
  } catch (error) {
    await db.reminderLog.update({
      where: { id: log.id },
      data: {
        attemptCount: 1,
        error: error instanceof Error ? error.message : "Delivery failed.",
        nextAttemptAt: new Date(now.getTime() + FIRST_RETRY_MS),
      },
    });
    return false;
  }
}

/**
 * Runs every policy for every active owner, then revalidates queued failures
 * against the owner's current state before retrying them.
 */
export async function processReminderDeliveries(
  now = new Date(),
  dependencies: { db?: Db; send?: typeof deliverToChannel } = {},
): Promise<{ sent: number; failed: number }> {
  const db = dependencies.db ?? prisma;
  const send = dependencies.send ?? deliverToChannel;
  let sent = 0;
  let failed = 0;

  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      preference: {
        select: { timezone: true, privacyLockEnabled: true, digestEnabled: true, digestHour: true },
      },
      notificationChannels: { where: { isEnabled: true } },
    },
  });
  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const user of users) {
    if (user.notificationChannels.length === 0) continue;
    const candidates = await candidatesForUser(db, user, now);
    if (candidates.length === 0) continue;

    // An overdue cadence or task stays a candidate every hour until someone
    // acts on it, so most of what is owed on any pass has already been sent.
    // One read of the keys already in the ledger keeps that from being one
    // failed insert per item per channel per hour, with the unique key kept
    // for the race between two schedulers rather than as the normal path.
    const pairs = candidates.flatMap((candidate) =>
      user.notificationChannels.map((channel) => ({ candidate, channel, dedupKey: dedupKeyFor(user, candidate, channel) })),
    );
    const ledgered = new Set(
      (await db.reminderLog.findMany({
        where: { ownerId: user.id, dedupKey: { in: pairs.map((pair) => pair.dedupKey) } },
        select: { dedupKey: true },
      })).map((row) => row.dedupKey),
    );
    for (const { candidate, channel, dedupKey } of pairs) {
      if (ledgered.has(dedupKey)) continue;
      const result = await createAndDeliver(db, send, user, candidate, channel, dedupKey, now);
      if (result === true) sent += 1;
      if (result === false) failed += 1;
    }
  }

  const retries = await db.reminderLog.findMany({
    where: {
      ok: false,
      channelId: { not: null },
      attemptCount: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      channel: { isEnabled: true },
    },
    include: { channel: true },
  });
  for (const log of retries) {
    if (!log.channel) continue;
    const user = usersById.get(log.ownerId);
    const message = user ? await currentMessage(db, user, log, now) : null;
    if (message === NOT_YET) continue;
    if (!message) {
      // Policy, state or privacy changes cancel queued delivery rather than
      // leaking content that is no longer meant to go out.
      await db.reminderLog.update({
        where: { id: log.id },
        data: { nextAttemptAt: null, error: "Delivery cancelled by current state, policy, or privacy." },
      });
      continue;
    }
    try {
      await send(log.channel, message.subject, message.body);
      await db.reminderLog.update({
        where: { id: log.id },
        data: { ok: true, sentAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, error: null },
      });
      sent += 1;
    } catch (error) {
      const attempt = log.attemptCount + 1;
      await db.reminderLog.update({
        where: { id: log.id },
        data: {
          attemptCount: attempt,
          error: error instanceof Error ? error.message : "Delivery failed.",
          nextAttemptAt: attempt < MAX_ATTEMPTS ? new Date(now.getTime() + 60_000 * 2 ** (attempt - 1)) : null,
        },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}

/** The name the hourly scheduler and the existing tests call it by. */
export const processImportantDateReminders = processReminderDeliveries;
