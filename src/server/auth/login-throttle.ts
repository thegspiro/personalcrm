import "server-only";
import {
  FAILURES_BEFORE_BACKOFF,
  MAX_BACKOFF_MS,
  MAX_FRESH_PAIRS,
  MAX_PENALISED_PAIRS,
  backoffRemainingMs,
  describeWait,
  isStale,
} from "@/lib/login-throttle";

/**
 * Sign-in throttling.
 *
 * Held in this process rather than in a table. Counting an attempt before the
 * password is checked is the only way to stop a burst — a gate that merely
 * reads yields before bcrypt, and then every request in the burst sees the same
 * pre-threshold count and takes a turn. On disk that means a write per attempt,
 * and both halves of the key come from whoever is knocking, so the store is one
 * an attacker sizes; bounding it then means evicting records, and evicting a
 * record that is refusing somebody is the throttle switching itself off. In
 * memory neither half costs anything: reserving is one synchronous mutation, so
 * nothing interleaves between reading a count and writing it back.
 *
 * Entries live in two populations, and that split is what keeps admission
 * honest *and* cheap:
 *
 *  * `fresh` holds pairs below the threshold. None of them can be refusing
 *    anybody, so any of them may be dropped at any moment and dropping one
 *    hands nothing back.
 *  * `penalised` holds pairs that have reached it. These are the ones worth
 *    protecting, and they are never dropped to make room.
 *
 * Every earlier version searched for a victim on each admission and got the
 * predicate wrong in a new way each time — too eager and a live counter was
 * reset, too cautious and every unseen pair was refused, unbounded and the
 * search itself became the attack. Splitting the populations removes the
 * search: the victim is the front of `fresh`, which is safe by construction.
 *
 * Both maps are kept in last-touched order, which is also `failedAt` order
 * because a touch and a bump happen together. That makes the front entry the
 * oldest, so one look at it answers a question about all of them, and nothing
 * in the request path ever walks more than a single entry.
 *
 * What this costs, and neither is hidden from the operator:
 *
 *  * Counters do not survive a restart. Someone who can restart the container
 *    can clear them — but they already have the database.
 *  * Each replica keeps its own. A deployment running N of these allows N
 *    times the attempts before backoff bites. Single-container is the intended
 *    shape; see docs/privacy.md.
 */

export interface ThrottleDecision {
  /** The attempt must be refused without checking the password. */
  blocked: boolean;
  /** Seconds until another attempt is allowed. Zero unless blocked. */
  retryAfterSeconds: number;
  /** Ready-to-render sentence, or null when not blocked. */
  message: string | null;
}

const ALLOWED: ThrottleDecision = { blocked: false, retryAfterSeconds: 0, message: null };

/** What a caller is told when there is no room left among the protected. */
const NO_ROOM_WAIT_MS = 60_000;

function refuse(remainingMs: number): ThrottleDecision {
  return {
    blocked: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    // Says nothing about whether the address has an account behind it: the
    // same sentence is produced for an address that has never existed, and for
    // a limiter with no room left.
    message: `Too many sign-in attempts. Try again in ${describeWait(remainingMs)}.`,
  };
}

interface Attempt {
  failedCount: number;
  /** Epoch milliseconds of the most recent attempt. */
  failedAt: number;
}

/**
 * One pair of maps per *process*, not per bundle.
 *
 * They hang off `globalThis` for the same reason the Prisma client does, and
 * here it is a correctness requirement rather than a convenience: a production
 * build emits this module into more than one chunk — verified, two of them — so
 * plain module-level maps would be one set per chunk. The login action would
 * count against one, the scheduled prune would tidy another, and the same
 * action posted to a route served by a different chunk would find an allowance
 * nobody had spent.
 */
const globalForLimiter = globalThis as unknown as {
  loginFresh?: Map<string, Attempt>;
  loginPenalised?: Map<string, Attempt>;
};

/** Below the threshold. Never refusing anybody, so always safe to drop. */
const fresh: Map<string, Attempt> = (globalForLimiter.loginFresh ??= new Map());

/** At or past the threshold. Never dropped to make room. */
const penalised: Map<string, Attempt> = (globalForLimiter.loginPenalised ??= new Map());

/**
 * The key an attempt is counted under. `ip` is normalised, never null.
 *
 * Both halves are truncated, and that is load-bearing rather than tidiness.
 * The entry ceilings bound how many keys are held, not how large they are, and
 * nothing upstream bounds the address: a syntactically valid one can arrive
 * megabytes long inside an 8 MB action body and then be retained for a day.
 * The lengths are the ones the old columns imposed — an address longer than
 * this could never have been stored, so it can never belong to an account.
 */
const MAX_KEY_EMAIL = 191;
const MAX_KEY_IP = 64;

export function attemptKey(email: string, ip: string | null | undefined): string {
  // NUL separated: neither an address nor a client address can contain one, so
  // no pair can be made to collide with a different pair.
  const address = email.trim().toLowerCase().slice(0, MAX_KEY_EMAIL);
  return `${address}\u0000${(ip ?? "").slice(0, MAX_KEY_IP)}`;
}

/** Move an entry to the back of its map, so the front stays the oldest. */
function touch(map: Map<string, Attempt>, key: string, entry: Attempt): void {
  map.delete(key);
  map.set(key, entry);
}

/**
 * Take the oldest entry from a map when it is certainly spent.
 *
 * One look, never a walk. Both maps are in `failedAt` order, so the front is
 * the oldest; if *it* is still within the longest wait the schedule can
 * produce then so is everything behind it, and there is nothing to take.
 * Deliberately a coarse over-estimate of "still live" — the exact wait depends
 * on `failedCount`, and erring toward keeping a counter is the safe direction.
 */
function dropOldestSpent(map: Map<string, Attempt>, now: number): boolean {
  const front = map.entries().next();
  if (front.done) return false;

  const [key, entry] = front.value;
  if (!isStale(entry.failedAt, now) && entry.failedAt >= now - MAX_BACKOFF_MS) return false;

  map.delete(key);
  return true;
}

/**
 * Admit a pair that has just reached the threshold into the protected map.
 *
 * Returns false when there is no room, which is the one case where a counter
 * cannot be kept. Refusing the attempt is then the safe answer: the alternative
 * is leaving a penalised counter among the freely evictable ones, which is
 * exactly the reset this split exists to prevent.
 */
function promote(key: string, entry: Attempt, now: number): boolean {
  if (penalised.size >= MAX_PENALISED_PAIRS && !dropOldestSpent(penalised, now)) {
    return false;
  }
  fresh.delete(key);
  penalised.set(key, entry);
  return true;
}

/**
 * Claim this attempt, and say whether it may proceed.
 *
 * Call this *before* verifying the password, and note that it is deliberately
 * synchronous: the whole point is that nothing can interleave between reading
 * the count and writing it back. An asynchronous gate — even a fast one —
 * yields before the password check, so every request in a burst reads the same
 * pre-threshold count and every one of them gets a guess.
 *
 * An allowed attempt has been counted, so a caller whose sign-in then succeeds
 * must follow up with `clearLoginAttempts`.
 */
export function reserveLoginAttempt(
  email: string,
  ip: string | null | undefined,
  now: number = Date.now(),
): ThrottleDecision {
  const key = attemptKey(email, ip);
  const kept = penalised.get(key);
  const entry = kept ?? fresh.get(key);

  if (entry) {
    if (isStale(entry.failedAt, now)) {
      // Old enough that the earlier failures say nothing about this one, so it
      // goes back to being an ordinary first attempt.
      penalised.delete(key);
      entry.failedCount = 1;
      entry.failedAt = now;
      touch(fresh, key, entry);
      return ALLOWED;
    }

    const remainingMs = backoffRemainingMs(entry.failedCount, entry.failedAt, now);
    if (remainingMs > 0) {
      // Deliberately not incremented. Someone already waiting should be able
      // to wait the stated time out; extending it on every refused attempt
      // would mean an impatient person never gets back in.
      return refuse(remainingMs);
    }

    const failedCount = entry.failedCount + 1;
    if (!kept && failedCount >= FAILURES_BEFORE_BACKOFF) {
      const promoted = { failedCount, failedAt: now };
      if (!promote(key, promoted, now)) return refuse(NO_ROOM_WAIT_MS);
      return ALLOWED;
    }

    entry.failedCount = failedCount;
    entry.failedAt = now;
    touch(kept ? penalised : fresh, key, entry);
    return ALLOWED;
  }

  if (fresh.size >= MAX_FRESH_PAIRS) {
    // The front of `fresh` is below the threshold by construction, so it is
    // refusing nobody and dropping it hands nothing back. No search, no
    // predicate to get wrong, and no walk on the request path.
    const oldest = fresh.keys().next();
    if (!oldest.done) fresh.delete(oldest.value);
  }

  fresh.set(key, { failedCount: 1, failedAt: now });
  return ALLOWED;
}

/**
 * Forget the attempts for one address from one client. Called on a successful
 * sign-in, so a person who mistyped four times starts clean once they get in.
 */
export function clearLoginAttempts(email: string, ip: string | null | undefined): void {
  const key = attemptKey(email, ip);
  fresh.delete(key);
  penalised.delete(key);
}

/**
 * Drop entries past the retention window.
 *
 * Housekeeping rather than a bound — the map sizes are the bound. This walks
 * both maps, which is why it belongs on the hourly tick and not in the request
 * path: it stops a long-lived process holding entries nobody will read again,
 * and keeps room free so admission rarely has to drop anything.
 */
export function pruneLoginAttempts(now: number = Date.now()): number {
  let removed = 0;
  for (const map of [fresh, penalised]) {
    for (const [key, entry] of map) {
      if (isStale(entry.failedAt, now)) {
        map.delete(key);
        removed += 1;
      }
    }
  }
  return removed;
}

/** Test seam: how many pairs are currently tracked, across both populations. */
export function trackedPairCount(): number {
  return fresh.size + penalised.size;
}

/** Test seam: how many carry a penalty. */
export function penalisedPairCount(): number {
  return penalised.size;
}

/** Test seam: forget everything. */
export function resetLoginAttempts(): void {
  fresh.clear();
  penalised.clear();
}
