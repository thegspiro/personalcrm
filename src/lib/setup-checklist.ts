/**
 * When the dashboard still has setup advice to offer.
 *
 * Derived from real rows rather than a stored flag, and deliberately so. The
 * migration that added `onboardingCompletedAt` had to backfill every existing
 * account, which means that column cannot tell a brand-new account apart from
 * one that has been in use for a year. Emptiness can.
 *
 * The install row rides along inside the checklist but never keeps it open:
 * `pwaInstalledAt` is null for every account on an upgraded instance, so keying
 * on it would nag all of them forever.
 */
export interface ChecklistState {
  hasPeople: boolean;
  hasInteractions: boolean;
  hasInstalled: boolean;
}

export function needsSetupChecklist(state: ChecklistState): boolean {
  return !state.hasPeople || !state.hasInteractions;
}
