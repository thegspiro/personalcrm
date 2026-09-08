/**
 * Deciding that two contacts might be the same person.
 *
 * Deliberately narrow: a shared email address, or a shared phone number, and
 * nothing else. Names are not compared at all — not "Bob" against "Robert", not
 * even "Sarah Jones" against "Sarah Jones". Merging is irreversible here, and a
 * suggestion somebody accepts on a busy afternoon destroys a real person's
 * record; two people who share an email address are almost always one person,
 * and two people who share a name very often are not.
 *
 * Even this narrow rule is not infallible in a *personal* address book, where a
 * couple share one landline. That is what `DuplicateDismissal` is for.
 */

/** Which kind of detail two contacts turned out to share. */
export type MatchKind = "email" | "phone";

export interface MethodValue {
  /** True when the contact method's type is an email address. */
  isEmail: boolean;
  value: string;
}

/**
 * An email address reduced to what two entries must share to be the same one.
 *
 * Case and surrounding space only. Deliberately *not* the tricks a mail
 * provider happens to allow — no dots stripped from the local part, no `+tag`
 * removed — because those are one provider's routing rules, not a rule about
 * addresses, and applying them would merge two people whose addresses differ.
 */
export function normaliseEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // Enough to tell an address from a note somebody typed in the field.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * A phone number reduced to its digits, and compared whole.
 *
 * `docs/README.md` records why numbers are not normalised for *search*:
 * guessing a country nobody supplied is how a number acquires the wrong one.
 * Comparison is a different question — both sides are the owner's own entries,
 * and neither is being rewritten — but the same caution applies to the
 * comparison itself, so `+1 555 010 4477` and `555 010 4477` are two different
 * strings of digits and stay two different numbers. Matching them would mean
 * deciding the shorter one is American.
 *
 * Seven digits is the shortest real subscriber number; below that this is an
 * extension or a note, and matching on it would pair everyone who wrote "x210".
 */
const MIN_PHONE_DIGITS = 7;

export function normalisePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits : null;
}

/** The comparable form of one contact method, or null if it is not comparable. */
export function normaliseMethod(method: MethodValue): { kind: MatchKind; key: string } | null {
  if (method.isEmail) {
    const email = normaliseEmail(method.value);
    return email ? { kind: "email", key: `email:${email}` } : null;
  }
  const phone = normalisePhone(method.value);
  return phone ? { kind: "phone", key: `phone:${phone}` } : null;
}

/**
 * A pair in a fixed order, so A/B and B/A are one pair rather than two.
 *
 * The same convention `FamilySuggestionDismissal` already uses, for the same
 * reason: a dismissal recorded one way round has to be found the other.
 */
export function orderedPair(a: string, b: string): { aContactId: string; bContactId: string } {
  return a < b ? { aContactId: a, bContactId: b } : { aContactId: b, bContactId: a };
}

export function pairKey(a: string, b: string): string {
  const ordered = orderedPair(a, b);
  return `${ordered.aContactId}:${ordered.bContactId}`;
}

export interface ContactMethods {
  contactId: string;
  methods: readonly MethodValue[];
}

export interface DuplicatePair {
  aContactId: string;
  bContactId: string;
  /** Every detail the two share, so the review screen can say why. */
  matches: Array<{ kind: MatchKind; value: string }>;
}

/**
 * Every pair of contacts sharing at least one comparable detail.
 *
 * Grouped by normalised value rather than compared pairwise: comparing every
 * contact against every other is quadratic, and an address book is exactly the
 * shape where that stops being free.
 *
 * A value shared by more than two contacts yields every pair among them. That
 * is right for a family of four on one landline — each pair is a separate
 * decision, and dismissing one says nothing about the others.
 */
export function findDuplicatePairs(contacts: readonly ContactMethods[]): DuplicatePair[] {
  const byKey = new Map<string, { kind: MatchKind; value: string; contactIds: Set<string> }>();

  for (const contact of contacts) {
    for (const method of contact.methods) {
      const normalised = normaliseMethod(method);
      if (!normalised) continue;
      const bucket = byKey.get(normalised.key) ?? {
        kind: normalised.kind,
        value: method.value.trim(),
        contactIds: new Set<string>(),
      };
      bucket.contactIds.add(contact.contactId);
      byKey.set(normalised.key, bucket);
    }
  }

  const pairs = new Map<string, DuplicatePair>();
  for (const bucket of byKey.values()) {
    // One contact holding the same address twice is not a pair with itself.
    const ids = [...bucket.contactIds];
    if (ids.length < 2) continue;

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = pairKey(ids[i]!, ids[j]!);
        const existing = pairs.get(key);
        if (existing) {
          existing.matches.push({ kind: bucket.kind, value: bucket.value });
          continue;
        }
        pairs.set(key, {
          ...orderedPair(ids[i]!, ids[j]!),
          matches: [{ kind: bucket.kind, value: bucket.value }],
        });
      }
    }
  }

  return [...pairs.values()];
}
