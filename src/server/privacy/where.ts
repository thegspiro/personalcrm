import type { Prisma } from "@prisma/client";

/**
 * Where-fragments that keep private content out of query results while the
 * lock is closed.
 *
 * This is the actual enforcement point. Hiding a section in a component is not
 * a lock — with server components the data would still have been fetched and
 * serialised into the payload sent to the browser. Filtering here means locked
 * content never leaves the database.
 *
 * Deliberately pure and free of request context so it can be tested directly
 * against a database; `./filter.ts` supplies the live scope.
 */
export interface PrivacyScope {
  /** Private rows may be returned. */
  unlocked: boolean;
  /** The lock is configured and switched on. */
  enabled: boolean;
}

/** Applied to Contact queries. */
export function contactPrivacyWhere(scope: PrivacyScope): Prisma.ContactWhereInput {
  return scope.unlocked ? {} : { isPrivate: false };
}

/** Applied to Fact queries. */
export function factPrivacyWhere(scope: PrivacyScope): Prisma.FactWhereInput {
  return scope.unlocked ? {} : { isPrivate: false };
}

/**
 * Applied to Associate queries.
 *
 * Only the row's own marker: the person it hangs off may be private too, and
 * that is a separate question answered by `viaContactPrivacyWhere` alongside
 * this one — exactly as a fact is filtered.
 */
export function associatePrivacyWhere(
  scope: PrivacyScope,
): Prisma.AssociateWhereInput {
  return scope.unlocked ? {} : { isPrivate: false };
}

/** Applied to Debt queries. */
export function debtPrivacyWhere(scope: PrivacyScope): Prisma.DebtWhereInput {
  return scope.unlocked ? {} : { isPrivate: false };
}

/**
 * Applied to Interaction queries.
 *
 * An interaction is withheld when it is itself marked private OR when any
 * participant is — logging "dinner" against a private person should not leak
 * through the timeline just because the interaction was never marked.
 */
export function interactionPrivacyWhere(scope: PrivacyScope): Prisma.InteractionWhereInput {
  if (scope.unlocked) return {};
  return {
    isPrivate: false,
    participants: { none: { contact: { isPrivate: true } } },
    mentions: { none: { contact: { isPrivate: true } } },
  };
}

/**
 * Applied to LifeEvent queries.
 *
 * A life event has one anchor contact and any number of participants, so
 * filtering on the anchor alone admits "Mum's wedding" when the person she
 * married is the private one. The timeline withheld that event and the settings
 * tally counted it, which answers how many hidden events exist from a page the
 * lock does not gate.
 */
export function lifeEventPrivacyWhere(scope: PrivacyScope): Prisma.LifeEventWhereInput {
  if (scope.unlocked) return {};
  return {
    contact: { isPrivate: false },
    participants: { none: { contact: { isPrivate: true } } },
  };
}

/** Applied to anything reached through a contact relation. */
export function viaContactPrivacyWhere(
  scope: PrivacyScope,
): { contact?: Prisma.ContactWhereInput } {
  return scope.unlocked ? {} : { contact: { isPrivate: false } };
}

/**
 * Applied where the contact relation is optional — a follow-up or an idea can
 * stand on its own, with no one attached.
 *
 * It has to be one fragment rather than `viaContactPrivacyWhere` dropped into
 * an `OR` beside `{ contactId: null }`, because that fragment is `{}` when
 * unlocked and an empty member of an `OR` matches nothing rather than
 * everything. That inversion emptied the whole list for exactly the accounts
 * entitled to see all of it — including every account that never switched the
 * lock on, which is unlocked by definition.
 */
export function viaOptionalContactPrivacyWhere(scope: PrivacyScope): {
  OR?: Array<{ contactId?: null; contact?: Prisma.ContactWhereInput }>;
} {
  return scope.unlocked
    ? {}
    : { OR: [{ contactId: null }, { contact: { isPrivate: false } }] };
}

/**
 * Applied to household lists.
 *
 * Household names and notes have no marker of their own, but a household whose
 * members include a private contact can identify that contact even after the
 * nested member list is filtered. That includes a mixed public/private
 * household: its free-text name or notes may still name the private member.
 * Empty households are retained because they contain no contact-derived
 * private information.
 */
export function householdPrivacyWhere(scope: PrivacyScope): Prisma.HouseholdWhereInput {
  if (scope.unlocked) return {};
  return { members: { none: { contact: { isPrivate: true } } } };
}
