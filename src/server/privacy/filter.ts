import "server-only";
import { getPrivacyState, recordProtectedReadActivity } from "./lock";
import type { PrivacyScope } from "./where";

export {
  contactPrivacyWhere,
  debtPrivacyWhere,
  factPrivacyWhere,
  householdPrivacyWhere,
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  viaContactPrivacyWhere,
  viaOptionalContactPrivacyWhere,
  type PrivacyScope,
} from "./where";

/** The live privacy scope for this request. */
export async function privacyScope(): Promise<PrivacyScope> {
  const { enabled, unlocked } = await getPrivacyState();
  // Every caller is a private-capable database read. Refresh only after its
  // server-side gate has admitted the request, never from generic navigation.
  if (enabled && unlocked) await recordProtectedReadActivity();
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
  if (enabled && unlocked) await recordProtectedReadActivity();
  return !enabled || unlocked;
}
