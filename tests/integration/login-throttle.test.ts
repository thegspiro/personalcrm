import { beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase, prisma, reset } from "./db";
import {
  ATTEMPT_TTL_MS,
  FAILURES_BEFORE_BACKOFF,
} from "@/lib/login-throttle";

const {
  registerLoginAttempt,
  clearLoginAttempts,
  purgeStaleLoginAttempts,
} = await import("@/server/auth/login-throttle");

const EMAIL = "someone@example.com";
const IP = "203.0.113.7";

/** Burn the free attempts so the next one is the throttled one. */
async function exhaustAllowance(email = EMAIL, ip = IP, now = new Date()) {
  for (let i = 0; i < FAILURES_BEFORE_BACKOFF; i += 1) {
    const decision = await registerLoginAttempt(email, ip, now, prisma);
    expect(decision.blocked).toBe(false);
  }
}

describe.skipIf(!hasTestDatabase)("sign-in throttling", () => {
  beforeEach(async () => {
    await reset();
  });

  it("lets the allowance through, then closes the door", async () => {
    const now = new Date();
    await exhaustAllowance(EMAIL, IP, now);

    const blocked = await registerLoginAttempt(EMAIL, IP, now, prisma);
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(5);
    expect(blocked.message).toContain("Too many sign-in attempts");
  });

  it("counts an address with no account behind it", async () => {
    // If only real accounts were counted, being throttled would itself answer
    // the question the login error refuses to: whether that address is ours.
    // No user is created in this test at all.
    const now = new Date();
    await exhaustAllowance("nobody-here@example.com", IP, now);

    const blocked = await registerLoginAttempt("nobody-here@example.com", IP, now, prisma);
    expect(blocked.blocked).toBe(true);
  });

  it("does not extend the wait when someone keeps trying while blocked", async () => {
    const now = new Date();
    await exhaustAllowance(EMAIL, IP, now);

    const first = await registerLoginAttempt(EMAIL, IP, now, prisma);
    // Four seconds later the wait should have counted down, not restarted.
    const later = new Date(now.getTime() + 4_000);
    const second = await registerLoginAttempt(EMAIL, IP, later, prisma);

    expect(first.retryAfterSeconds).toBe(5);
    expect(second.retryAfterSeconds).toBe(1);

    const rows = await prisma.loginAttempt.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].failedCount).toBe(FAILURES_BEFORE_BACKOFF);
  });

  it("opens again once the wait is served", async () => {
    const now = new Date();
    await exhaustAllowance(EMAIL, IP, now);
    expect((await registerLoginAttempt(EMAIL, IP, now, prisma)).blocked).toBe(true);

    const after = new Date(now.getTime() + 5_001);
    expect((await registerLoginAttempt(EMAIL, IP, after, prisma)).blocked).toBe(false);
  });

  it("throttles one client without locking the account's owner out", async () => {
    // The reason this is keyed on the pair rather than counted on the user: an
    // attacker who knows an address must not be able to lock its owner out.
    const now = new Date();
    await exhaustAllowance(EMAIL, "198.51.100.9", now);
    expect((await registerLoginAttempt(EMAIL, "198.51.100.9", now, prisma)).blocked).toBe(true);

    const owner = await registerLoginAttempt(EMAIL, "203.0.113.7", now, prisma);
    expect(owner.blocked).toBe(false);
  });

  it("keeps two accounts on one address apart", async () => {
    const now = new Date();
    await exhaustAllowance("first@example.com", IP, now);
    expect((await registerLoginAttempt("first@example.com", IP, now, prisma)).blocked).toBe(true);
    expect((await registerLoginAttempt("second@example.com", IP, now, prisma)).blocked).toBe(false);
  });

  it("normalises the address so case and padding cannot buy extra attempts", async () => {
    const now = new Date();
    await exhaustAllowance(EMAIL, IP, now);

    const shouted = await registerLoginAttempt("  SOMEONE@Example.COM ", IP, now, prisma);
    expect(shouted.blocked).toBe(true);
    expect(await prisma.loginAttempt.count()).toBe(1);
  });

  it("counts requests that carry no client address as one group", async () => {
    const now = new Date();
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF; i += 1) {
      await registerLoginAttempt(EMAIL, null, now, prisma);
    }
    const blocked = await registerLoginAttempt(EMAIL, undefined, now, prisma);

    expect(blocked.blocked).toBe(true);
    expect(await prisma.loginAttempt.count()).toBe(1);
  });

  it("forgets a run of failures once the retention window passes", async () => {
    // Five typos yesterday must not throttle the first attempt today.
    const now = new Date();
    await exhaustAllowance(EMAIL, IP, now);

    const tomorrow = new Date(now.getTime() + ATTEMPT_TTL_MS + 1);
    const fresh = await registerLoginAttempt(EMAIL, IP, tomorrow, prisma);

    expect(fresh.blocked).toBe(false);
    const rows = await prisma.loginAttempt.findMany();
    expect(rows[0].failedCount).toBe(1);
  });

  it("starts clean after a successful sign-in", async () => {
    const now = new Date();
    // Four wrong, then the right one — which clears the record.
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF - 1; i += 1) {
      await registerLoginAttempt(EMAIL, IP, now, prisma);
    }
    await clearLoginAttempts(EMAIL, IP, prisma);

    expect(await prisma.loginAttempt.count()).toBe(0);
    await exhaustAllowance(EMAIL, IP, now);
  });

  it("sweeps rows past the retention window and leaves current ones", async () => {
    const now = new Date();
    await registerLoginAttempt(EMAIL, IP, new Date(now.getTime() - ATTEMPT_TTL_MS - 60_000), prisma);
    await registerLoginAttempt("recent@example.com", IP, now, prisma);

    expect(await purgeStaleLoginAttempts(now, prisma)).toBe(1);
    const left = await prisma.loginAttempt.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].email).toBe("recent@example.com");
  });
});
