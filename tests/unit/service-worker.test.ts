import { describe, expect, it } from "vitest";
import {
  reduceWorkerSnapshot,
  type WorkerUpdateState,
} from "@/components/offline/offline";

describe("service worker update state", () => {
  it("moves through installing, waiting, activation, and controller change", () => {
    let state: { update: WorkerUpdateState; failures: number } = {
      update: "idle",
      failures: 0,
    };
    state = reduceWorkerSnapshot(state, "installing");
    expect(state.update).toBe("installing");
    state = reduceWorkerSnapshot(state, "installed");
    expect(state.update).toBe("waiting");
    state = reduceWorkerSnapshot(state, "activate");
    expect(state.update).toBe("activating");
    state = reduceWorkerSnapshot(state, "activated");
    expect(state).toEqual({ update: "idle", failures: 0 });
  });

  it("returns to idle and counts repeated registration failures", () => {
    const once = reduceWorkerSnapshot({ update: "installing", failures: 0 }, "failed");
    expect(once).toEqual({ update: "idle", failures: 1 });
    expect(reduceWorkerSnapshot(reduceWorkerSnapshot(once, "failed"), "failed").failures).toBe(3);
  });
});
