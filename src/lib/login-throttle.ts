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
 * Milliseconds still to wait, or 0 when an attempt may proceed.
 *
 * Doubling from five seconds: 5s, 10s, 20s … capped at fifteen minutes. The
 * clock runs from the most recent attempt, so continuing to guess keeps the
 * door shut rather than running the timer down.
 */
export function backoffRemainingMs(
  failedCount: number,
  failedAt: Date | null,
  now: number = Date.now(),
): number {
  if (!failedAt || failedCount < FAILURES_BEFORE_BACKOFF) return 0;
  const over = failedCount - FAILURES_BEFORE_BACKOFF;
  const delay = Math.min(MAX_BACKOFF_MS, 2 ** over * 5_000);
  return Math.max(0, failedAt.getTime() + delay - now);
}

/** True when a stored attempt row is old enough to count as a fresh start. */
export function isStale(failedAt: Date | null, now: number = Date.now()): boolean {
  return !failedAt || now - failedAt.getTime() > ATTEMPT_TTL_MS;
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
