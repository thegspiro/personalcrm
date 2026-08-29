import { describe, expect, it } from "vitest";
import { howLongAgo, reduceWorkerSnapshot, type WorkerUpdateState } from "@/components/offline/offline";

/**
 * How old a saved copy is.
 *
 * The whole point of the offline banner is that stale data must not look
 * live, so the number has to be right at the scale that matters — ten minutes
 * and twenty hours are both "today", and only one of them should worry you.
 */
const NOW = new Date("2026-03-11T14:30:00Z");
const ago = (seconds: number) => howLongAgo(new Date(NOW.getTime() - seconds * 1000), NOW);

describe("howLongAgo", () => {
  it("treats anything under a minute as just now", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(60)).toMatch(/minute/);
    expect(ago(45 * 60)).toMatch(/45 minutes/);
    expect(ago(2 * 3600)).toMatch(/2 hours/);
    expect(ago(3 * 86400)).toMatch(/3 days/);
  });

  it("distinguishes ten minutes from twenty hours", () => {
    // Both are "today" to a day-granular formatter, which is exactly why this
    // does not reuse relativeInstant.
    expect(ago(10 * 60)).not.toBe(ago(20 * 3600));
  });

  it("keeps going past a week", () => {
    expect(ago(10 * 86400)).toMatch(/week/);
    expect(ago(60 * 86400)).toMatch(/month/);
  });

  it("does not throw on a bad timestamp", () => {
    expect(howLongAgo(new Date("nonsense"), NOW)).toBe("just now");
  });
});

describe("service worker update state", () => {
  it("moves through installing, waiting, activation, and controller change", () => {
    let state: { update: WorkerUpdateState; failures: number } = { update: "idle", failures: 0 };
    state = reduceWorkerSnapshot(state, "installing");
    expect(state.update).toBe("installing");
    state = reduceWorkerSnapshot(state, "installed");
    expect(state.update).toBe("waiting");
    state = reduceWorkerSnapshot(state, "activate");
    expect(state.update).toBe("activating");
    state = reduceWorkerSnapshot(state, "activated");
    expect(state).toEqual({ update: "idle", failures: 0 });
  });

  it("counts repeated registration failures", () => {
    const once = reduceWorkerSnapshot({ update: "installing", failures: 0 }, "failed");
    expect(once).toEqual({ update: "idle", failures: 1 });
    expect(reduceWorkerSnapshot(reduceWorkerSnapshot(once, "failed"), "failed").failures).toBe(3);
  });
});
