import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTEMPT_TTL_MS,
  FAILURES_BEFORE_BACKOFF,
  MAX_BACKOFF_MS,
  MAX_FRESH_PAIRS,
  MAX_PENALISED_PAIRS,
  MAX_TRACKED_PAIRS,
} from "@/lib/login-throttle";
import {
  attemptKey,
  clearLoginAttempts,
  pruneLoginAttempts,
  penalisedPairCount,
  reserveLoginAttempt,
  resetLoginAttempts,
  trackedPairCount,
} from "@/server/auth/login-throttle";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const EMAIL = "someone@example.com";
const IP = "203.0.113.7";

/** Burn the free attempts so the next one is the throttled one. */
function exhaustAllowance(email = EMAIL, ip = IP, now = T0) {
  for (let i = 0; i < FAILURES_BEFORE_BACKOFF; i += 1) {
    expect(reserveLoginAttempt(email, ip, now).blocked).toBe(false);
  }
}

describe("sign-in limiter", () => {
  beforeEach(() => {
    resetLoginAttempts();
  });

  it("lets the allowance through, then closes the door", () => {
    exhaustAllowance();
    const blocked = reserveLoginAttempt(EMAIL, IP, T0);

    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(5);
    expect(blocked.message).toContain("Too many sign-in attempts");
  });

  it("counts an address with no account behind it", () => {
    // If only real accounts were counted, being throttled would itself answer
    // the question the login error refuses to: whether that address is ours.
    exhaustAllowance("nobody-here@example.com");
    expect(reserveLoginAttempt("nobody-here@example.com", IP, T0).blocked).toBe(true);
  });

  it("does not extend the wait when someone keeps trying while blocked", () => {
    exhaustAllowance();
    expect(reserveLoginAttempt(EMAIL, IP, T0).retryAfterSeconds).toBe(5);
    // Four seconds later the wait has counted down, not restarted.
    expect(reserveLoginAttempt(EMAIL, IP, T0 + 4_000).retryAfterSeconds).toBe(1);
  });

  it("opens again once the wait is served", () => {
    exhaustAllowance();
    expect(reserveLoginAttempt(EMAIL, IP, T0).blocked).toBe(true);
    expect(reserveLoginAttempt(EMAIL, IP, T0 + 5_001).blocked).toBe(false);
  });

  it("escalates as the guessing continues", () => {
    exhaustAllowance();
    // The sixth is taken once the first wait is served; the next is longer.
    expect(reserveLoginAttempt(EMAIL, IP, T0 + 5_001).blocked).toBe(false);
    expect(reserveLoginAttempt(EMAIL, IP, T0 + 5_002).retryAfterSeconds).toBe(10);
  });

  it("throttles one client without locking the account's owner out", () => {
    // Why the key is a pair and not the account: someone who knows an address
    // must not be able to lock its owner out by guessing at it.
    exhaustAllowance(EMAIL, "198.51.100.9");
    expect(reserveLoginAttempt(EMAIL, "198.51.100.9", T0).blocked).toBe(true);
    expect(reserveLoginAttempt(EMAIL, "203.0.113.7", T0).blocked).toBe(false);
  });

  it("keeps two accounts on one address apart", () => {
    exhaustAllowance("first@example.com");
    expect(reserveLoginAttempt("first@example.com", IP, T0).blocked).toBe(true);
    expect(reserveLoginAttempt("second@example.com", IP, T0).blocked).toBe(false);
  });

  it("normalises the address so case and padding cannot buy extra attempts", () => {
    exhaustAllowance();
    expect(reserveLoginAttempt("  SOMEONE@Example.COM ", IP, T0).blocked).toBe(true);
    expect(trackedPairCount()).toBe(1);
  });

  it("counts requests that carry no client address as one group", () => {
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF; i += 1) {
      reserveLoginAttempt(EMAIL, null, T0);
    }
    expect(reserveLoginAttempt(EMAIL, undefined, T0).blocked).toBe(true);
    expect(trackedPairCount()).toBe(1);
  });

  it("cannot be confused by an address spanning the separator", () => {
    // The pair is NUL separated precisely so no address can be crafted to
    // land on another pair's counter.
    exhaustAllowance("a@b.com", "1.2.3.4");
    expect(reserveLoginAttempt("a@b.com", "1.2.3.4", T0).blocked).toBe(true);
    expect(reserveLoginAttempt("a@b.com\u00001.2.3.4", "", T0).blocked).toBe(false);
  });

  it("forgets a run of failures once the retention window passes", () => {
    // Five typos yesterday must not throttle the first attempt today.
    exhaustAllowance();
    expect(reserveLoginAttempt(EMAIL, IP, T0 + ATTEMPT_TTL_MS + 1).blocked).toBe(false);
  });

  it("starts clean after a successful sign-in", () => {
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF - 1; i += 1) {
      reserveLoginAttempt(EMAIL, IP, T0);
    }
    clearLoginAttempts(EMAIL, IP);

    expect(trackedPairCount()).toBe(0);
    exhaustAllowance();
  });

  it("has no window a burst can slip through", () => {
    // The failure the durable version could not close: an asynchronous gate
    // yields before the password check, so every request in a burst reads the
    // same pre-threshold count and each takes a turn. Reserving is one
    // synchronous mutation, so a hundred callers get the allowance between
    // them rather than one each.
    const allowed = Array.from({ length: 100 }, () =>
      reserveLoginAttempt(EMAIL, IP, T0),
    ).filter((decision) => !decision.blocked);

    expect(allowed).toHaveLength(FAILURES_BEFORE_BACKOFF);
  });
});

describe("limiter capacity", () => {
  beforeEach(() => {
    resetLoginAttempts();
  });

  it("never grows past its ceiling however many keys are thrown at it", () => {
    // Both halves of the key come from the caller, so the set of keys is
    // theirs to choose. The fixed size is the whole defence.
    for (let i = 0; i < MAX_FRESH_PAIRS + 500; i += 1) {
      reserveLoginAttempt(`flood-${i}@example.com`, IP, T0 + i);
    }
    expect(trackedPairCount()).toBeLessThanOrEqual(MAX_TRACKED_PAIRS);
  });

  it("will not drop a counter that carries a penalty, even between its waits", () => {
    // The bug this split exists to make unreachable. A counter at the
    // threshold whose current wait has just elapsed is not spent — it still
    // escalates the next one. Dropping it restarts the attacker at one.
    exhaustAllowance("target@example.com", IP, T0);
    expect(penalisedPairCount()).toBe(1);

    // Its five-second wait elapses, so it is not blocking at this instant.
    const after = T0 + 6_000;
    // Now flood, which is exactly when eviction runs.
    for (let i = 0; i < MAX_FRESH_PAIRS + 500; i += 1) {
      reserveLoginAttempt(`junk-${i}@example.com`, IP, after);
    }

    // The counter survived with its history, so the next guess escalates to
    // ten seconds rather than starting over at five.
    expect(reserveLoginAttempt("target@example.com", IP, after).blocked).toBe(false);
    expect(reserveLoginAttempt("target@example.com", IP, after).retryAfterSeconds).toBe(10);
  });

  it("admits without walking the map, however many counters are protected", () => {
    // The other half of the oscillation: a bounded search refused pairs it
    // should have admitted, an unbounded one made admission the attack. There
    // is no search now — the victim is the front of the un-penalised map,
    // which is safe by construction.
    for (let i = 0; i < MAX_PENALISED_PAIRS; i += 1) {
      exhaustAllowance(`blocked-${i}@example.com`, IP, T0);
    }
    expect(penalisedPairCount()).toBe(MAX_PENALISED_PAIRS);

    // Every protected slot is taken and every one is live, and a brand new
    // pair is still admitted immediately.
    expect(reserveLoginAttempt("newcomer@example.com", IP, T0).blocked).toBe(false);
  });

  it("refuses to promote when every protected counter is still live", () => {
    // The one case where a counter cannot be kept. Refusing is the safe
    // answer: leaving a penalised counter among the freely evictable ones is
    // the reset this split exists to prevent.
    for (let i = 0; i < MAX_PENALISED_PAIRS; i += 1) {
      exhaustAllowance(`blocked-${i}@example.com`, IP, T0);
    }

    // A newcomer reaching the threshold has nowhere to be promoted to.
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF - 1; i += 1) {
      expect(reserveLoginAttempt("late@example.com", IP, T0).blocked).toBe(false);
    }
    expect(reserveLoginAttempt("late@example.com", IP, T0).blocked).toBe(true);
    expect(penalisedPairCount()).toBe(MAX_PENALISED_PAIRS);
  });

  it("makes room among the protected once the oldest is certainly spent", () => {
    for (let i = 0; i < MAX_PENALISED_PAIRS; i += 1) {
      exhaustAllowance(`blocked-${i}@example.com`, IP, T0);
    }
    // Past the longest wait the schedule can produce, so the oldest is spent.
    const later = T0 + MAX_BACKOFF_MS + 1_000;

    for (let i = 0; i < FAILURES_BEFORE_BACKOFF; i += 1) {
      expect(reserveLoginAttempt("late@example.com", IP, later).blocked).toBe(false);
    }
    expect(penalisedPairCount()).toBe(MAX_PENALISED_PAIRS);
    expect(reserveLoginAttempt("late@example.com", IP, later).blocked).toBe(true);
  });

  it("admits again once entries have been pruned", () => {
    for (let i = 0; i < MAX_PENALISED_PAIRS; i += 1) {
      exhaustAllowance(`blocked-${i}@example.com`, IP, T0);
    }
    const later = T0 + ATTEMPT_TTL_MS + 1;

    expect(pruneLoginAttempts(later)).toBe(MAX_PENALISED_PAIRS);
    expect(trackedPairCount()).toBe(0);
    expect(reserveLoginAttempt("newcomer@example.com", IP, later).blocked).toBe(false);
  });

  it("leaves entries still within the retention window", () => {
    reserveLoginAttempt(EMAIL, IP, T0);
    expect(pruneLoginAttempts(T0 + 1_000)).toBe(0);
    expect(trackedPairCount()).toBe(1);
  });
});
