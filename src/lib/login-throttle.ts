/**
 * Backoff for repeated sign-in attempts.
 *
 * The privacy PIN has had this since it shipped; the front door did not, which
 * left the secondary lock better defended than the primary one. The arithmetic
 * is deliberately the same shape as `src/server/privacy/lock.ts` so the two
 * behave alike, but it is kept pure and takes `now`, so the schedule can be
 * asserted without a clock.
 */

/** Attempts allowed at full speed before backoff starts. */
export const FAILURES_BEFORE_BACKOFF = 5;

/** The longest anyone is ever asked to wait. */
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * How long a record of past failures survives.
 *
 * Without this, five typos spread over a year would throttle the sixth attempt
 * as if they had been consecutive. Backoff is meant to slow a burst, not to
 * hold a grudge.
 */
export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The most address-and-client pairs tracked at once.
 *
 * Both halves of the key come from whoever is knocking, so the set of keys is
 * chosen by them, not by us. This is what keeps that from mattering: the
 * limiter holds a fixed number of entries in memory and never more, so there
 * is no amount of traffic that turns it into a storage problem. Far above what
 * a personal instance ever sees, and a few megabytes at worst.
 */
export const MAX_TRACKED_PAIRS = 50_000;

/**
 * How many of those may carry a penalty.
 *
 * Entries are held in two populations, and this is the size of the one that
 * matters. A penalised entry has reached the threshold and is either refusing
 * somebody now or escalating the next wait if they come back; it is never
 * dropped to make room. Reaching this many takes five failures apiece —
 * fifty thousand requests — where filling the other population takes one each.
 */
export const MAX_PENALISED_PAIRS = 10_000;

/**
 * How many pairs below the threshold are kept.
 *
 * These carry no penalty yet, so any of them can be dropped at any time
 * without handing anything back. That is what makes admission O(1): the
 * least-recently-touched one is always a safe victim, so there is never a
 * search for a victim in the request path.
 */
export const MAX_FRESH_PAIRS = MAX_TRACKED_PAIRS - MAX_PENALISED_PAIRS;

/**
 * Milliseconds still to wait, or 0 when an attempt may proceed.
 *
 * Doubling from five seconds: 5s, 10s, 20s … capped at fifteen minutes. The
 * clock runs from the most recent attempt, so continuing to guess keeps the
 * door shut rather than running the timer down.
 */
export function backoffRemainingMs(
  failedCount: number,
  failedAt: number | null,
  now: number = Date.now(),
): number {
  if (failedAt === null || failedCount < FAILURES_BEFORE_BACKOFF) return 0;
  const over = failedCount - FAILURES_BEFORE_BACKOFF;
  const delay = Math.min(MAX_BACKOFF_MS, 2 ** over * 5_000);
  return Math.max(0, failedAt + delay - now);
}

/** True when a recorded attempt is old enough to count as a fresh start. */
export function isStale(failedAt: number | null, now: number = Date.now()): boolean {
  return failedAt === null || now - failedAt > ATTEMPT_TTL_MS;
}

/**
 * "30 seconds" / "2 minutes", for the message shown to whoever is waiting.
 *
 * Rounded up, so the interface never invites a retry that will be refused.
 */
export function describeWait(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
