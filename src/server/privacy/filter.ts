import "server-only";
import { getPrivacyState } from "./lock";
import type { PrivacyScope } from "./where";

export {
  contactPrivacyWhere,
  debtPrivacyWhere,
  factPrivacyWhere,
  householdPrivacyWhere,
  interactionPrivacyWhere,
  viaContactPrivacyWhere,
  type PrivacyScope,
} from "./where";

/** The live privacy scope for this request. */
export async function privacyScope(): Promise<PrivacyScope> {
  const { enabled, unlocked } = await getPrivacyState();
  return { enabled, unlocked };
}

/**
 * Whether the dating layer may be shown at all.
 *
 * Distinct from the row filters: romantic contacts stay visible in People
 * while locked, because a person vanishing from your contact list is its own
 * tell. Only their dating sections are withheld. Hiding someone entirely is
 * what marking them private is for.
 */
export async function canSeeDating(hideDating: boolean): Promise<boolean> {
  if (hideDating) return false;
  const { enabled, unlocked } = await getPrivacyState();
  return !enabled || unlocked;
}
