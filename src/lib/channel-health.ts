/**
 * Whether a notification channel is actually delivering, and when to stop
 * asking.
 *
 * A channel that has quietly stopped working is the one failure this app
 * cannot report through the thing that broke. Until this existed, a revoked
 * Gotify token, a rotated SMTP password or a host that started answering 404
 * looked exactly like a week with nothing due: the ledger recorded every
 * failure and nothing ever read it back.
 *
 * Pure: no Prisma, no `server-only`, so the settings component and the
 * scheduler share one set of rules rather than two that drift.
 */

/**
 * How many attempts a single reminder gets before it is given up on.
 *
 * Lives here rather than in the scheduler because two things need the same
 * number — the scheduler to stop retrying, and the health read to tell an
 * abandoned row apart from one still in flight. Read from two places, defined
 * in one.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * How many abandoned reminders since the last success pause a channel.
 *
 * Counted in whole reminders rather than attempts, because attempts say more
 * about how much was due than about how broken the channel is: an account with
 * six reminders in one morning would burn through an attempt-based threshold
 * during a single restart. Three reminders that each exhausted every attempt is
 * something no brief outage produces.
 */
export const PAUSE_AFTER_ABANDONED = 3;

/**
 * How long a paused channel waits before one real delivery is tried anyway.
 *
 * A pause has to be able to end without you noticing it began — a self-hosted
 * box that comes back after an overnight upgrade should heal on its own, or the
 * pause has simply replaced one kind of silence with another. Daily rather than
 * hourly so a genuinely dead host is asked once a day, not twenty-four times.
 */
export const PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a delivered ledger row is kept.
 *
 * Only rows whose occurrence cannot come round again are ever deleted — see
 * `PRUNABLE_POLICIES`. The window is long enough that "when did this last
 * work?" is still answerable for a channel nobody has looked at in a season.
 */
export const LEDGER_RETENTION_DAYS = 90;

/**
 * The policies whose delivered rows may be deleted once they are old enough.
 *
 * **Not every row is safe to delete, and this is the trap.** The ledger row is
 * the only thing stopping a reminder being sent a second time, and two policies
 * regenerate an identical candidate for as long as you do nothing about them:
 * `OVERDUE_CADENCE` keys on `Contact.nextTouchAt`, which does not move until an
 * interaction is logged, and `INCOMPLETE_TASK_DUE` keys on a due date that
 * stays put until the task is completed. Delete either row and the very next
 * hourly pass writes it again and sends it again.
 *
 * They are also not what makes the table grow: there is one row per contact and
 * per task, not one per day. The daily digest is the one that accumulates —
 * a row per account, per channel, per day — and its occurrence is a date that
 * never comes round again. Important dates and plans are the same: last year's
 * occurrence is not a candidate this year.
 */
export const PRUNABLE_POLICIES = [
  "DAILY_DIGEST",
  "IMPORTANT_DATE_OFFSET",
  "SCHEDULED_PLAN",
] as const;

/** What Settings needs to say whether a channel is working. */
export interface ChannelHealth {
  /** ISO instant of the last delivery that succeeded, or null if none ever has. */
  lastOkAt: string | null;
  /** ISO instant of the most recent failed attempt. */
  lastFailureAt: string | null;
  /**
   * Why that attempt failed. Transport text only — an HTTP code, a refused
   * connection, a credential that will not decrypt. `ReminderLog.error` never
   * holds message content, so nothing here can name a person.
   */
  lastError: string | null;
  /** Reminders given up on since the last success. Zero once one gets through. */
  abandoned: number;
  /** ISO instant this channel was paused automatically, or null. */
  pausedAt: string | null;
  /** The failure that paused it. */
  pauseReason: string | null;
}

export type ChannelState = "untried" | "healthy" | "failing" | "paused";

/**
 * One word for the card to lead with.
 *
 * `failing` rather than `paused` while attempts are still being made, because
 * the two ask different things of the reader: one is "this may right itself",
 * the other is "nothing more will be tried until you look".
 */
export function channelState(health: ChannelHealth): ChannelState {
  if (health.pausedAt) return "paused";
  if (health.abandoned > 0) return "failing";
  if (health.lastOkAt) {
    // A failure after the last success is a channel that has started failing,
    // even before any reminder has exhausted its attempts.
    return health.lastFailureAt && health.lastFailureAt > health.lastOkAt ? "failing" : "healthy";
  }
  return health.lastFailureAt ? "failing" : "untried";
}

/** Whether this run of failures is enough to stop attempting. */
export function shouldPause(abandoned: number): boolean {
  return abandoned >= PAUSE_AFTER_ABANDONED;
}

/**
 * Whether a paused channel is due its daily probe.
 *
 * `lastProbeAt` null means it has not been probed since it was paused, so the
 * first pass after the pause tries one — the outage that caused it may already
 * be over by the time the third reminder was given up on.
 */
export function dueForProbe(
  channel: { pausedAt: Date | null; lastProbeAt: Date | null },
  now: Date,
): boolean {
  if (!channel.pausedAt) return false;
  if (!channel.lastProbeAt) return true;
  return now.getTime() - channel.lastProbeAt.getTime() >= PROBE_INTERVAL_MS;
}
