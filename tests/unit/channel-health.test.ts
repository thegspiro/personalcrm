import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_ATTEMPTS,
  PAUSE_AFTER_ABANDONED,
  PROBE_INTERVAL_MS,
  PRUNABLE_POLICIES,
  channelState,
  dueForProbe,
  shouldPause,
  type ChannelHealth,
} from "@/lib/channel-health";

const NOTHING: ChannelHealth = {
  lastOkAt: null,
  lastFailureAt: null,
  lastError: null,
  abandoned: 0,
  pausedAt: null,
  pauseReason: null,
};

describe("channelState", () => {
  it("says nothing has been tried rather than claiming health", () => {
    // A channel added a minute ago has delivered nothing and failed at
    // nothing. Reading that as healthy is the reassuring answer and the wrong
    // one: it is exactly the state a channel that will never work is also in.
    expect(channelState(NOTHING)).toBe("untried");
  });

  it("is healthy only while the last thing that happened was a delivery", () => {
    expect(channelState({ ...NOTHING, lastOkAt: "2026-09-01T10:00:00.000Z" })).toBe("healthy");
    expect(
      channelState({
        ...NOTHING,
        lastOkAt: "2026-09-01T10:00:00.000Z",
        lastFailureAt: "2026-09-01T09:00:00.000Z",
      }),
    ).toBe("healthy");
  });

  it("reports failing on a failure since the last success, before anything is abandoned", () => {
    // Four hours pass between the first failed attempt and the reminder being
    // given up on. Waiting for the abandonment to say anything would leave the
    // card claiming health through the entire window in which it is breaking.
    expect(
      channelState({
        ...NOTHING,
        lastOkAt: "2026-09-01T09:00:00.000Z",
        lastFailureAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toBe("failing");
    expect(channelState({ ...NOTHING, lastFailureAt: "2026-09-01T10:00:00.000Z" })).toBe("failing");
  });

  it("prefers paused over failing, because they ask different things of the reader", () => {
    // Failing may right itself; paused means nothing more is being tried on
    // its own. Leading with the wrong one leaves you waiting for a retry that
    // is not coming.
    expect(
      channelState({
        ...NOTHING,
        abandoned: 9,
        lastFailureAt: "2026-09-01T10:00:00.000Z",
        pausedAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toBe("paused");
  });
});

describe("shouldPause", () => {
  it("holds out for a run no brief outage produces", () => {
    expect(shouldPause(PAUSE_AFTER_ABANDONED - 1)).toBe(false);
    expect(shouldPause(PAUSE_AFTER_ABANDONED)).toBe(true);
  });

  it("counts reminders, and each one costs every attempt it was given", () => {
    // Stated as a number rather than a comment: three reminders is fifteen
    // attempts, which is the property that makes a restart unable to trip it.
    expect(PAUSE_AFTER_ABANDONED * MAX_DELIVERY_ATTEMPTS).toBe(15);
  });
});

describe("dueForProbe", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");

  it("never probes a channel that is not paused", () => {
    expect(dueForProbe({ pausedAt: null, lastProbeAt: null }, now)).toBe(false);
    expect(dueForProbe({ pausedAt: null, lastProbeAt: new Date(0) }, now)).toBe(false);
  });

  it("probes immediately after a pause, then once a day", () => {
    // The outage that caused the pause may already be over by the time the
    // third reminder was given up on, so the first pass after it tries.
    expect(dueForProbe({ pausedAt: now, lastProbeAt: null }, now)).toBe(true);

    const justProbed = new Date(now.getTime() - PROBE_INTERVAL_MS + 60_000);
    expect(dueForProbe({ pausedAt: now, lastProbeAt: justProbed }, now)).toBe(false);

    const aDayAgo = new Date(now.getTime() - PROBE_INTERVAL_MS);
    expect(dueForProbe({ pausedAt: now, lastProbeAt: aDayAgo }, now)).toBe(true);
  });
});

describe("what may be pruned", () => {
  it("never prunes a policy whose candidate regenerates", () => {
    // The ledger row is the only thing stopping a second send. An overdue
    // cadence keys on `Contact.nextTouchAt` and a due task on its due date;
    // neither moves until you act, so both are candidates again on the very
    // next hourly pass. Deleting one of those rows does not tidy history — it
    // re-sends the reminder, for ever, once per retention sweep.
    expect(PRUNABLE_POLICIES).not.toContain("OVERDUE_CADENCE");
    expect(PRUNABLE_POLICIES).not.toContain("INCOMPLETE_TASK_DUE");
  });

  it("prunes the one that accumulates by the day", () => {
    // A digest writes a row per account, per channel, per day, and yesterday's
    // date is never a candidate again.
    expect(PRUNABLE_POLICIES).toContain("DAILY_DIGEST");
  });
});
