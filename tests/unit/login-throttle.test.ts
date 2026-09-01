import { describe, expect, it } from "vitest";
import {
  ATTEMPT_TTL_MS,
  FAILURES_BEFORE_BACKOFF,
  MAX_BACKOFF_MS,
  backoffRemainingMs,
  describeWait,
  isStale,
} from "@/lib/login-throttle";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

describe("backoffRemainingMs", () => {
  it("lets the first attempts through at full speed", () => {
    for (let count = 0; count < FAILURES_BEFORE_BACKOFF; count += 1) {
      expect(backoffRemainingMs(count, T0, T0)).toBe(0);
    }
  });

  it("waits five seconds once the allowance is spent", () => {
    expect(backoffRemainingMs(FAILURES_BEFORE_BACKOFF, T0, T0)).toBe(5_000);
  });

  it("doubles with each further attempt", () => {
    expect(backoffRemainingMs(6, T0, T0)).toBe(10_000);
    expect(backoffRemainingMs(7, T0, T0)).toBe(20_000);
    expect(backoffRemainingMs(8, T0, T0)).toBe(40_000);
  });

  it("never asks anyone to wait more than the ceiling", () => {
    // Doubling from five seconds passes fifteen minutes at the eighth attempt
    // over; a hundred failures must not mean a wait measured in years.
    expect(backoffRemainingMs(100, T0, T0)).toBe(MAX_BACKOFF_MS);
  });

  it("counts down as real time passes", () => {
    expect(backoffRemainingMs(6, T0, T0 + 4_000)).toBe(6_000);
    expect(backoffRemainingMs(6, T0, T0 + 10_000)).toBe(0);
    // Never negative: a long-past failure is simply over, not owed back.
    expect(backoffRemainingMs(6, T0, T0 + 999_000)).toBe(0);
  });

  it("has nothing to enforce without a recorded attempt", () => {
    expect(backoffRemainingMs(50, null, T0)).toBe(0);
  });
});

describe("isStale", () => {
  it("treats a fresh attempt as current", () => {
    expect(isStale(T0, T0 + 1_000)).toBe(false);
    expect(isStale(T0, T0 + ATTEMPT_TTL_MS)).toBe(false);
  });

  it("forgets attempts past the retention window", () => {
    // Five typos last week must not throttle the first attempt today.
    expect(isStale(T0, T0 + ATTEMPT_TTL_MS + 1)).toBe(true);
  });

  it("treats a missing record as a clean start", () => {
    expect(isStale(null, T0)).toBe(true);
  });
});

describe("describeWait", () => {
  it("rounds up, so the message never invites a retry that is refused", () => {
    expect(describeWait(4_100)).toBe("5 seconds");
    expect(describeWait(1)).toBe("1 second");
    expect(describeWait(59_000)).toBe("59 seconds");
    expect(describeWait(60_000)).toBe("1 minute");
    expect(describeWait(60_001)).toBe("2 minutes");
    expect(describeWait(MAX_BACKOFF_MS)).toBe("15 minutes");
  });
});

