import { describe, expect, it } from "vitest";
import { needsSetupChecklist } from "@/lib/setup-checklist";

/**
 * When the dashboard still offers guidance.
 *
 * The rule has to hold in two directions. A brand-new account needs telling
 * what to do; an instance that has been in use for a year and is only now
 * upgrading must never be told it hasn't finished setting up. Emptiness is what
 * separates them — not a stored flag, which the migration had to backfill and
 * so cannot tell the two apart.
 */
describe("needsSetupChecklist", () => {
  it("shows for an account with nothing in it", () => {
    expect(
      needsSetupChecklist({ hasPeople: false, hasInteractions: false, hasInstalled: false }),
    ).toBe(true);
  });

  it("keeps showing once there are people but nothing logged", () => {
    expect(
      needsSetupChecklist({ hasPeople: true, hasInteractions: false, hasInstalled: false }),
    ).toBe(true);
  });

  it("goes away once the app is genuinely in use", () => {
    expect(
      needsSetupChecklist({ hasPeople: true, hasInteractions: true, hasInstalled: false }),
    ).toBe(false);
  });

  it("does not hang around just because the app was never installed", () => {
    // An existing install upgrading into this has pwaInstalledAt null for every
    // account. Keying on it would nag every one of them forever.
    expect(
      needsSetupChecklist({ hasPeople: true, hasInteractions: true, hasInstalled: false }),
    ).toBe(false);
  });
});
