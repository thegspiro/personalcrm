import "server-only";
import { Prisma, type ReminderEntity } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  addPlainDays,
  calendarDateInTz,
  comparePlainDates,
  diffPlainDays,
  endOfDayInTz,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  todayInTz,
  zonedStartOfDay,
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
  type DigestItem,
  type ReminderMessage,
  type SchedulingPolicy,
} from "@/lib/reminder-schedule";
import { deliverToChannel } from "./notify";

const MAX_ATTEMPTS = 5;
/** How soon after a failed send the next attempt may be made. */
const FIRST_RETRY_MS = 60_000;
/**
 * How long a row is held while its delivery is in flight, both when it is
 * first written and when a retry claims it. Longer than any delivery can take:
 * the HTTP channels abort at fifteen seconds and SMTP is bounded to about a
 * minute of connecting, greeting and sending. Only after this can another
 * pass conclude the sender is gone and take the row over.
 */
const CLAIM_LEASE_MS = 5 * 60_000;
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

/** An owner the scheduler may act for: one whose preference row exists. */
type ScheduledUser = UserSchedule & { preference: NonNullable<UserSchedule["preference"]> };

/** The owner's clock, as every policy sees it. */
type Schedule = { timezone: string; locked: boolean; today: PlainDate };

function scheduleFor(user: Pick<ScheduledUser, "preference">, now: Date): Schedule {
  const timezone = user.preference.timezone || DEFAULT_TIMEZONE;
  return {
    timezone,
    locked: user.preference.privacyLockEnabled,
    today: todayInTz(timezone, now),
  };
}

/**
 * Without a preference row there is no timezone to anchor a day to and no
 * lock setting to honour — and reading the lock as "off" would send a
 * private person's name out of the building for an owner who set a PIN
 * before a partial import dropped the row. The avatar query treats that
 * state as locked; so does this, by leaving such an owner alone entirely.
 * Their next request creates the row, and the next pass picks them up.
 */
function hasPreferences(user: UserSchedule): user is ScheduledUser {
  return user.preference !== null;
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
function cadenceWhere(user: Pick<ScheduledUser, "id">, schedule: Schedule, now: Date) {
  return {
    ownerId: user.id,
    ...visibleContact(schedule.locked),
    nextTouchAt: { lte: endOfDayInTz(now, schedule.timezone) },
  };
}

/**
 * A task's contact must belong to the same owner. The two are independent
 * foreign keys, so a repaired or partially imported row can point at someone
 * else's person; that name must never travel through this owner's channels.
 */
function taskContactWhere(user: Pick<ScheduledUser, "id">, schedule: Schedule) {
  return { OR: [{ contactId: null }, { contact: { ownerId: user.id, ...visibleContact(schedule.locked) } }] };
}

function taskWhere(user: Pick<ScheduledUser, "id">, schedule: Schedule) {
  return {
    ownerId: user.id,
    completedAt: null,
    dueDate: { lte: plainDateToDb(schedule.today) },
    ...taskContactWhere(user, schedule),
  };
}

/**
 * How far past today the digest looks. Standalone reminders are unaffected:
 * each still fires on its own policy, on its own day.
 */
const DIGEST_LOOKAHEAD_DAYS = 2;

/**
 * The digest reads wider than any delivery policy does, so it gets its own
 * where-fragments rather than reusing `cadenceWhere` and `taskWhere`.
 *
 * Those two decide what is *owed* — widening them would send every reminder
 * two days early, which is the opposite of what a look-ahead is for. Seeing an
 * item here must never be able to create its standalone candidate, so the two
 * reads are kept deliberately apart even though they overlap.
 */
function digestCadenceWhere(user: Pick<ScheduledUser, "id">, schedule: Schedule, through: PlainDate) {
  return {
    ownerId: user.id,
    ...visibleContact(schedule.locked),
    // The last instant of the final local day, so a cadence due that evening
    // is included, the way `cadenceWhere` reads its own day.
    nextTouchAt: { lte: new Date(zonedStartOfDay(addPlainDays(through, 1), schedule.timezone).getTime() - 1) },
  };
}

function digestTaskWhere(user: Pick<ScheduledUser, "id">, schedule: Schedule, through: PlainDate) {
  return {
    ownerId: user.id,
    completedAt: null,
    dueDate: { lte: plainDateToDb(through) },
    ...taskContactWhere(user, schedule),
  };
}

/** Selects only fields that are permitted to leave the server in a digest. */
async function digestItemsForUser(db: Db, user: Pick<ScheduledUser, "id">, schedule: Schedule): Promise<DigestItem[]> {
  const through = addPlainDays(schedule.today, DIGEST_LOOKAHEAD_DAYS);
  const [dates, cadence, tasks] = await Promise.all([
    db.importantDate.findMany({
      where: { ownerId: user.id, contact: { ownerId: user.id, ...visibleContact(schedule.locked) } },
      select: {
        id: true, label: true, date: true, recurrence: true, reminderDaysBefore: true,
        contact: { select: { firstName: true, lastName: true } },
      },
    }),
    db.contact.findMany({
      where: digestCadenceWhere(user, schedule, through),
      select: { firstName: true, lastName: true, nextTouchAt: true },
    }),
    db.task.findMany({
      where: digestTaskWhere(user, schedule, through),
      select: { title: true, dueDate: true, contact: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const items: DigestItem[] = [];
  // An important date enters the digest on the days its own reminder policy
  // would speak, not on a flat two-day window: a birthday a week out is worth
  // knowing about precisely because its policy says a week. The look-ahead
  // adds the next two days' worth of those, so a reminder that will arrive
  // tomorrow is previewed today rather than being the first you hear of it.
  const seen = new Set<string>();
  for (const date of dates) {
    for (const offset of effectiveReminderDays(reminderPolicy(date.reminderDaysBefore))) {
      for (let ahead = 0; ahead <= DIGEST_LOOKAHEAD_DAYS; ahead++) {
        const occurrence = dueOccurrence(
          plainDateFromDb(date.date), date.recurrence, addPlainDays(schedule.today, ahead), offset,
        );
        if (!occurrence) continue;
        // Two offsets on two different days can name the same occurrence.
        // Keyed by row id, not by what is displayed: two people with the same
        // name sharing a birthday are two entries, not one.
        const key = `${date.id}\u0000${plainDateKey(occurrence)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          kind: "IMPORTANT_DATE", label: date.label, contactName: personName(date.contact), date: occurrence,
        });
      }
    }
  }
  for (const contact of cadence) {
    if (contact.nextTouchAt) items.push({
      kind: "CADENCE", contactName: personName(contact),
      date: calendarDateInTz(contact.nextTouchAt, schedule.timezone),
    });
  }
  for (const task of tasks) {
    if (task.dueDate) items.push({
      kind: "TASK", title: task.title,
      contactName: task.contact ? personName(task.contact) : null,
      date: plainDateFromDb(task.dueDate),
    });
  }
  return items;
}

async function candidatesForUser(db: Db, user: ScheduledUser, now: Date): Promise<Candidate[]> {
  const schedule = scheduleFor(user, now);
  const candidates: Candidate[] = [];

  const dates = await db.importantDate.findMany({
    where: { ownerId: user.id, contact: { ownerId: user.id, ...visibleContact(schedule.locked) } },
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

  if (user.preference.digestEnabled && digestIsDue(now, schedule.timezone, user.preference.digestHour)) {
    const digestItems = await digestItemsForUser(db, user, schedule);
    candidates.push({
      entityType: "DIGEST",
      entityId: user.id,
      policy: "DAILY_DIGEST",
      occurrence: dailyOccurrence(now, schedule.timezone),
      scheduledFor: plainDateToDb(schedule.today),
      offsetDays: 0,
      ...digestMessage(digestItems, schedule.today),
    });
  }
  return candidates;
}

/**
 * Whether a delivery is still owed, and what it should say now. Every send
 * passes through here, first attempts and retries alike, once its row is held.
 *
 * Deliberately not "is it among today's candidates": a send that fails on the
 * last hourly pass of a day is first retried on the next day's, when the
 * occurrence is no longer due and would never match. Each policy instead
 * re-reads its own row and applies the same ownership, archive and privacy
 * rules it was created under, so a completed task, a corrected date, a
 * contact made private or a digest switched off cancels the delivery — and
 * nothing else does. The one thing checked forwards rather than backwards is
 * that the occurrence has arrived in the owner's timezone *as it is now*: a
 * candidate read just after midnight in one zone is not yet due in a zone
 * the owner moved to a moment later, and goes out when it is.
 */
async function currentMessage(
  db: Db,
  user: Pick<ScheduledUser, "id" | "preference">,
  log: {
    entityType: ReminderEntity;
    entityId: string;
    schedulingPolicy: string;
    scheduledFor: Date;
    offsetDays: number;
    channelId: string | null;
    dedupKey: string;
  },
  now: Date,
): Promise<ReminderMessage | null | typeof NOT_YET> {
  const schedule = scheduleFor(user, now);
  const scheduled = plainDateFromDb(log.scheduledFor);

  switch (log.schedulingPolicy as SchedulingPolicy) {
    case "IMPORTANT_DATE_OFFSET": {
      const date = await db.importantDate.findFirst({
        where: { id: log.entityId, ownerId: user.id, contact: { ownerId: user.id, ...visibleContact(schedule.locked) } },
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
      if (diffPlainDays(schedule.today, occurrence) > log.offsetDays) return NOT_YET;
      return importantDateMessage(date.label, personName(date.contact), occurrence, schedule.today);
    }
    case "OVERDUE_CADENCE": {
      const contact = await db.contact.findFirst({
        where: { id: log.entityId, ownerId: user.id, ...visibleContact(schedule.locked) },
        select: { firstName: true, lastName: true, nextTouchAt: true },
      });
      if (!contact?.nextTouchAt || !log.channelId) return null;
      // An interaction logged since moved the cadence on; that reminder is
      // spent. The test is the instant the row was keyed by, not the local
      // date it fell on: a timezone change can move the date without the
      // cadence itself having moved, and must not cost the reminder.
      const stillOwed = reminderDedupKey({
        ownerId: user.id,
        entityType: log.entityType,
        entityId: log.entityId,
        policy: "OVERDUE_CADENCE",
        occurrence: contact.nextTouchAt.toISOString(),
        offsetDays: log.offsetDays,
        channelId: log.channelId,
      }) === log.dedupKey;
      if (!stillOwed) return null;
      if (contact.nextTouchAt > endOfDayInTz(now, schedule.timezone)) return NOT_YET;
      return cadenceMessage(personName(contact), calendarDateInTz(contact.nextTouchAt, schedule.timezone));
    }
    case "INCOMPLETE_TASK_DUE": {
      const task = await db.task.findFirst({
        where: { id: log.entityId, ownerId: user.id, completedAt: null, ...taskContactWhere(user, schedule) },
        include: { contact: CONTACT_NAME },
      });
      if (!task?.dueDate) return null;
      const dueDay = plainDateFromDb(task.dueDate);
      if (plainDateKey(dueDay) !== plainDateKey(scheduled)) return null;
      if (comparePlainDates(dueDay, schedule.today) > 0) return NOT_YET;
      return taskMessage(task.title, task.contact ? personName(task.contact) : null, dueDay);
    }
    case "DAILY_DIGEST": {
      // A digest is that day's summary. Once the day has ended it is either
      // out of date or a copy of the one about to be sent, so it is dropped
      // rather than retried; within the day its counts are read afresh.
      if (!user.preference.digestEnabled || plainDateKey(schedule.today) !== plainDateKey(scheduled)) {
        return null;
      }
      // The hour may have been moved later since the row was written. A fresh
      // candidate would wait for it; so does the retry, keeping its row and
      // its key rather than sending early or being cancelled outright.
      if (!digestIsDue(now, schedule.timezone, user.preference.digestHour)) return NOT_YET;
      return digestMessage(await digestItemsForUser(db, user, schedule), schedule.today);
    }
    default:
      return null;
  }
}

function dedupKeyFor(user: ScheduledUser, candidate: Candidate, channel: Channel): string {
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

const PREFERENCE = {
  select: { timezone: true, privacyLockEnabled: true, digestEnabled: true, digestHour: true },
} as const;

/**
 * The owner as they are right now, not as they were when the pass began.
 * A pass can take minutes across many owners and channels, and a lock
 * switched on in that time has to bind every send that follows it.
 */
function currentOwner(db: Db, ownerId: string) {
  return db.user.findUnique({
    where: { id: ownerId, isActive: true },
    select: { id: true, preference: PREFERENCE },
  });
}

/**
 * The channel as it is right now: still this owner's, still switched on.
 * A pass's opening snapshot can be minutes old by the time a send happens,
 * and a channel switched off, deleted or re-pointed in that time must not
 * be sent to. Ownership is checked too: the ledger's owner and channel are
 * independent foreign keys, so a repaired or imported row can name another
 * account's channel, and this owner's people must never go out through it.
 */
function currentChannel(db: Db, ownerId: string, channelId: string) {
  return db.notificationChannel.findFirst({ where: { id: channelId, ownerId, isEnabled: true } });
}

async function cancel(db: Db, id: string, reason: string) {
  await db.reminderLog.update({ where: { id }, data: { nextAttemptAt: null, error: reason } });
}

const CANCELLED = "Delivery cancelled by current state, policy, or privacy.";
const NO_CHANNEL = "Delivery cancelled: the channel is no longer this owner's, or is switched off.";

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
 *
 * What is sent is not the candidate as it was read at the top of the pass
 * but the reminder as it stands once the row is held: the owner and the
 * record are read again, under the same rules a retry is judged by. A lock
 * switched on, a task completed or a date corrected between the candidate
 * query and this send cancels the row rather than being sent past.
 */
async function createAndDeliver(
  db: Db,
  send: typeof deliverToChannel,
  user: ScheduledUser,
  candidate: Candidate,
  channel: Channel,
  dedupKey: string,
  now: Date,
  clock: () => Date,
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
        nextAttemptAt: new Date(clock().getTime() + CLAIM_LEASE_MS),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }

  const owner = await currentOwner(db, user.id);
  const message = owner?.preference
    ? await currentMessage(db, { id: owner.id, preference: owner.preference }, log, now)
    : null;
  if (message === NOT_YET) return null;
  if (!message) {
    await cancel(db, log.id, CANCELLED);
    return null;
  }
  const live = await currentChannel(db, user.id, channel.id);
  if (!live) {
    await cancel(db, log.id, NO_CHANNEL);
    return null;
  }
  try {
    await send(live, message.subject, message.body);
    await db.reminderLog.update({
      where: { id: log.id },
      data: { ok: true, sentAt: clock(), attemptCount: 1, nextAttemptAt: null },
    });
    return true;
  } catch (error) {
    // From the clock, like the lease: a deadline stamped from the pass's
    // opening instant could already have passed, and with it the backoff.
    await db.reminderLog.update({
      where: { id: log.id },
      data: {
        attemptCount: 1,
        error: error instanceof Error ? error.message : "Delivery failed.",
        nextAttemptAt: new Date(clock().getTime() + FIRST_RETRY_MS),
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
  at?: Date,
  dependencies: { db?: Db; send?: typeof deliverToChannel; clock?: () => Date } = {},
): Promise<{ sent: number; failed: number }> {
  const db = dependencies.db ?? prisma;
  const send = dependencies.send ?? deliverToChannel;
  // `now` is the pass's one reading of the calendar, so every owner is judged
  // against the same day. Leases are a different matter: a pass can run for
  // minutes across many owners and channels, and a deadline stamped from its
  // opening instant could already be spent by the time a row is written or
  // claimed, letting another process take the row mid-send. Those come from
  // the clock at the moment of the write. A test that fixes the pass time
  // fixes the clock with it unless it says otherwise.
  const now = at ?? new Date();
  const clock = dependencies.clock ?? (at ? () => at : () => new Date());
  let sent = 0;
  let failed = 0;

  const users = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, preference: PREFERENCE, notificationChannels: { where: { isEnabled: true } } },
  });

  for (const user of users) {
    if (!hasPreferences(user) || user.notificationChannels.length === 0) continue;
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
    const rows = await db.reminderLog.findMany({
      where: { ownerId: user.id, dedupKey: { in: pairs.map((pair) => pair.dedupKey) } },
      select: { id: true, dedupKey: true, ok: true, nextAttemptAt: true, attemptCount: true },
    });
    const ledgered = new Set(rows.map((row) => row.dedupKey));

    // A row cancelled while its reminder was ineligible — the task completed,
    // the person made private — keeps its key, so the candidate it matches
    // now would otherwise be skipped for ever once the task is reopened or
    // the person made visible again. Being a candidate again is exactly the
    // eligibility the cancellation was waiting on, so the row is put back on
    // the retry path, which revalidates and claims it like any other.
    const cancelled = rows.filter((row) => !row.ok && row.nextAttemptAt === null && row.attemptCount < MAX_ATTEMPTS);
    if (cancelled.length > 0) {
      await db.reminderLog.updateMany({
        where: { id: { in: cancelled.map((row) => row.id) }, ok: false, nextAttemptAt: null },
        data: { nextAttemptAt: now, error: null },
      });
    }
    for (const { candidate, channel, dedupKey } of pairs) {
      if (ledgered.has(dedupKey)) continue;
      const result = await createAndDeliver(db, send, user, candidate, channel, dedupKey, now, clock);
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
    },
  });
  // Not filtered by the channel's state: a retry whose channel is off must be
  // selected so the check after the claim can cancel it, rather than being
  // re-read every hour for nothing. Cancelled, it is treated like any other
  // cancelled row — put back on the retry path only if its reminder is a
  // candidate again on that channel, which is what the channel's return
  // makes true for whatever is still due, and for nothing else.
  for (const log of retries) {
    if (!log.channelId) continue;
    const owner = await currentOwner(db, log.ownerId);
    // An owner with no preference row is left alone, row included; one who
    // is no longer active has nothing owed.
    if (owner && owner.preference === null) continue;
    const message = owner?.preference
      ? await currentMessage(db, { id: owner.id, preference: owner.preference }, log, now)
      : null;
    if (message === NOT_YET) continue;
    if (!message) {
      // Policy, state or privacy changes cancel queued delivery rather than
      // leaking content that is no longer meant to go out.
      await cancel(db, log.id, CANCELLED);
      continue;
    }
    // Two processes can overlap — a rolling restart, or two replicas on one
    // external database — and both will have selected this row. The unique
    // key only guards the first delivery, so the retry is claimed the same
    // way: one conditional update wins, the other sees nothing to claim. The
    // claim is a lease longer than any delivery, so a process that dies
    // mid-send hands the row back, and one that is merely slow is not raced.
    const claimed = await db.reminderLog.updateMany({
      where: { id: log.id, ok: false, nextAttemptAt: log.nextAttemptAt },
      data: { nextAttemptAt: new Date(clock().getTime() + CLAIM_LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    // Read after the claim, not before it: the row is ours now, and the
    // channel must be the owner's and switched on at the moment of sending.
    const live = await currentChannel(db, log.ownerId, log.channelId);
    if (!live) {
      await cancel(db, log.id, NO_CHANNEL);
      continue;
    }
    try {
      await send(live, message.subject, message.body);
      await db.reminderLog.update({
        where: { id: log.id },
        data: { ok: true, sentAt: clock(), attemptCount: { increment: 1 }, nextAttemptAt: null, error: null },
      });
      sent += 1;
    } catch (error) {
      const attempt = log.attemptCount + 1;
      await db.reminderLog.update({
        where: { id: log.id },
        data: {
          attemptCount: attempt,
          error: error instanceof Error ? error.message : "Delivery failed.",
          nextAttemptAt: attempt < MAX_ATTEMPTS ? new Date(clock().getTime() + FIRST_RETRY_MS * 2 ** (attempt - 1)) : null,
        },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}

/** The name the hourly scheduler and the existing tests call it by. */
export const processImportantDateReminders = processReminderDeliveries;
