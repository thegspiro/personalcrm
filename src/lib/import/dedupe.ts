/**
 * Deciding whether someone in the file is already here.
 *
 * The judgement is deliberately conservative and deliberately *not* automatic.
 * Merging two people who turn out to be different is not undoable by hand, and
 * an import that quietly merged is worse than one that quietly duplicated: a
 * duplicate is visible and fixable, a bad merge has already lost whichever
 * value it did not keep. So this only ever *proposes*, and every proposal is
 * shown before anything is written.
 */
import type { ImportedContact } from "./types";

export interface ExistingContact {
  id: string;
  firstName: string;
  lastName: string | null;
  /** Every email already on file for them, however it is labelled. */
  emails: readonly string[];
}

export type MatchReason = "email" | "name";

export interface Duplicate {
  id: string;
  name: string;
  reason: MatchReason;
}

/** Lowercased and stripped of spacing, for comparison only. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normaliseName(first: string, last: string | null): string {
  return `${first} ${last ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The strongest match for this row, or null.
 *
 * An email in common is treated as the same person: two people sharing one is
 * possible but rare, and it is the signal every address book uses. A matching
 * full name is reported too, but as the weaker reason, because families share
 * them — which is exactly why the decision is left to a person.
 */
export function findDuplicate(
  candidate: ImportedContact,
  existing: readonly ExistingContact[],
): Duplicate | null {
  const emails = new Set(
    candidate.methods
      .filter((method) => method.slug === "email")
      .map((method) => normaliseEmail(method.value)),
  );

  if (emails.size > 0) {
    for (const person of existing) {
      if (person.emails.some((email) => emails.has(normaliseEmail(email)))) {
        return {
          id: person.id,
          name: normaliseName(person.firstName, person.lastName),
          reason: "email",
        };
      }
    }
  }

  const name = normaliseName(candidate.firstName, candidate.lastName);
  // A first name on its own is not enough to claim two people are the same.
  if (!candidate.lastName) return null;

  for (const person of existing) {
    if (normaliseName(person.firstName, person.lastName) === name) {
      return { id: person.id, name, reason: "name" };
    }
  }

  return null;
}

/**
 * Rows in the file that match each other.
 *
 * Files exported from two places and concatenated contain the same person
 * twice, and importing both would create the duplicate this is meant to catch
 * — without either of them matching anything already on file.
 */
export function findInternalDuplicates(contacts: readonly ImportedContact[]): Set<number> {
  const seenEmails = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const duplicates = new Set<number>();

  contacts.forEach((contact, index) => {
    let matched = false;
    for (const method of contact.methods) {
      if (method.slug !== "email") continue;
      const email = normaliseEmail(method.value);
      if (seenEmails.has(email)) matched = true;
      else seenEmails.set(email, index);
    }

    if (!matched && contact.lastName) {
      const name = normaliseName(contact.firstName, contact.lastName);
      if (seenNames.has(name)) matched = true;
      else seenNames.set(name, index);
    }

    if (matched) duplicates.add(index);
  });

  return duplicates;
}
