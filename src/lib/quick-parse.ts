/**
 * Reading one typed line into an interaction.
 *
 * "coffee with Sarah yesterday, she got the promotion" becomes a type, a
 * person, a date and a note — all of it worked out here, on your own machine,
 * with no key and no network. This is the whole feature; the optional Claude
 * layer in `src/server/ai/` only produces a better reading of the same shape
 * when you switch it on, and everything it can do this can do worse.
 *
 * Nothing here decides anything final. The result fills a form you confirm, so
 * being wrong costs a correction rather than a bad record.
 *
 * Pure and free of Prisma, so it unit-tests against a fixed clock.
 */
import * as chrono from "chrono-node";
import { calendarDateInTz, plainDateKey, type PlainDate } from "./dates";

export interface ParseContact {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname?: string | null;
  /** Private people are never sent to an external service. */
  isPrivate?: boolean;
}

export interface ParseType {
  id: string;
  slug: string;
  label: string;
}

export interface MatchedContact {
  contact: ParseContact;
  /** The words in the input that matched. */
  matchedText: string;
}

/**
 * A name that matches more than one person.
 *
 * Two relatives called John is not an edge case, it is a family. Guessing
 * between them would file a conversation against the wrong person and be
 * almost impossible to notice later, so the parser refuses to choose and the
 * UI asks.
 */
export interface AmbiguousName {
  /** The words in the input that matched. */
  matchedText: string;
  candidates: ParseContact[];
}

export interface QuickParseResult {
  /** People matched to exactly one contact. */
  contacts: MatchedContact[];
  /** Names matching several people — you pick, the parser never guesses. */
  ambiguous: AmbiguousName[];
  /** Capitalised words that look like names but match nobody. */
  unknownNames: string[];
  type: ParseType | null;
  /** The calendar date, in the account's timezone. Null means "now". */
  date: PlainDate | null;
  /** The date phrase that produced it, for showing your work. */
  dateText: string | null;
  /** A short title — what is left once the plumbing words are taken out. */
  title: string;
  /** Anything after a comma or dash, kept verbatim. */
  notes: string | null;
}

/** Words that join a sentence together and never name anything. */
const STOPWORDS = new Set([
  "a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to",
  "with", "we", "i", "me", "my", "our", "us", "she", "he", "they", "her",
  "him", "them", "his", "their", "had", "have", "has", "was", "were", "went",
  "got", "did", "saw", "met", "about", "up", "out", "over", "into", "then",
  "just", "also", "very", "really", "again",
]);

/**
 * Turn free text into the parts of an interaction.
 *
 * `now` and `timeZone` are passed in rather than read from the environment so
 * this is deterministic in tests and correct for the account rather than the
 * server — the same reason every other date path in the app takes a timezone.
 */
export function quickParse(
  input: string,
  context: { contacts: ParseContact[]; types: ParseType[]; now: Date; timeZone: string },
): QuickParseResult {
  const text = input.trim();
  if (!text) {
    return {
      contacts: [],
      ambiguous: [],
      unknownNames: [],
      type: null,
      date: null,
      dateText: null,
      title: "",
      notes: null,
    };
  }

  // People first, deliberately. Plenty of real names are also dates — April,
  // May, June — and letting the date parser run first would swallow the person
  // and file the interaction against nobody. A name you have recorded always
  // wins over a date reading of the same word.
  const { contacts, ambiguous, unknownNames, remainder: withoutPeople } = extractPeople(
    text,
    context.contacts,
  );
  const { type, withoutType } = extractType(withoutPeople, context.types);
  const { date, dateText, withoutDate } = extractDate(
    withoutType,
    context.now,
    context.timeZone,
  );
  const { title, notes } = splitTitleAndNotes(withoutDate, type, contacts);

  return { contacts, ambiguous, unknownNames, type, date, dateText, title, notes };
}

// --- dates -----------------------------------------------------------------

/**
 * Pull a date phrase out, and say which words it came from.
 *
 * `forwardDate: false` matters: a bare "Tuesday" while backfilling means the
 * Tuesday just gone, not the one coming. Logging is mostly about the past.
 */
function extractDate(
  text: string,
  now: Date,
  timeZone: string,
): { date: PlainDate | null; dateText: string | null; withoutDate: string } {
  // chrono works in the server's local zone, so ask it to reason relative to
  // the account's "now" and then read the answer back in the account's zone.
  const results = chrono.parse(text, now, { forwardDate: false });
  if (results.length === 0) return { date: null, dateText: null, withoutDate: text };

  // The longest match wins: "last Tuesday" beats "Tuesday".
  const best = results.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  const parsed = best.date();
  if (!Number.isFinite(parsed.getTime())) {
    return { date: null, dateText: null, withoutDate: text };
  }

  const withoutDate = (text.slice(0, best.index) + " " + text.slice(best.index + best.text.length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { date: calendarDateInTz(parsed, timeZone), dateText: best.text, withoutDate };
}

// --- interaction types -----------------------------------------------------

function extractType(
  text: string,
  types: ParseType[],
): { type: ParseType | null; withoutType: string } {
  const lower = text.toLowerCase();

  // Longest label first, so "video call" wins over "call".
  const candidates = [...types].sort((a, b) => b.label.length - a.label.length);

  for (const type of candidates) {
    for (const needle of [type.label.toLowerCase(), type.slug.replace(/-/g, " ")]) {
      if (!needle) continue;
      const at = indexOfWord(lower, needle);
      if (at === -1) continue;
      const withoutType = (text.slice(0, at) + " " + text.slice(at + needle.length))
        .replace(/\s{2,}/g, " ")
        .trim();
      return { type, withoutType };
    }
  }

  return { type: null, withoutType: text };
}

/** Index of `needle` in `haystack` on word boundaries, or -1. */
function indexOfWord(haystack: string, needle: string): number {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, "i");
  const match = pattern.exec(haystack);
  if (!match) return -1;
  return match.index + (match[1] ? match[1].length : 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- people ----------------------------------------------------------------

function extractPeople(
  text: string,
  contacts: ParseContact[],
): {
  contacts: MatchedContact[];
  ambiguous: AmbiguousName[];
  unknownNames: string[];
  remainder: string;
} {
  const matched: MatchedContact[] = [];
  const ambiguous: AmbiguousName[] = [];
  const taken = new Set<string>();
  let remainder = text;

  /**
   * Every way a person can be named, grouped by the words used.
   *
   * Grouping by needle rather than by contact is the whole point: it is what
   * makes "John" visibly match two people instead of silently matching the
   * first one sorted. Longest needles are tried first so "John Whitfield"
   * resolves before the bare "John" ever gets a chance to be ambiguous.
   */
  const byNeedle = new Map<string, { needle: string; contacts: ParseContact[] }>();
  const offer = (contact: ParseContact, needle: string) => {
    const trimmed = needle.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const entry = byNeedle.get(key);
    if (entry) {
      if (!entry.contacts.includes(contact)) entry.contacts.push(contact);
    } else {
      byNeedle.set(key, { needle: trimmed, contacts: [contact] });
    }
  };

  for (const contact of contacts) {
    offer(contact, [contact.firstName, contact.lastName].filter(Boolean).join(" "));
    if (contact.nickname) offer(contact, contact.nickname);
    offer(contact, contact.firstName);
  }

  const ordered = [...byNeedle.values()].sort((a, b) => b.needle.length - a.needle.length);

  for (const entry of ordered) {
    // Looped, not matched once: "dinner with John and John" is two people, and
    // consuming only the first would leave the second looking like a stranger
    // and offer to create a third John.
    for (;;) {
      const at = indexOfWord(remainder.toLowerCase(), entry.needle.toLowerCase());
      if (at === -1) break;

      // Anyone already pinned down by a longer, more specific name is out of
      // the running — in "John Whitfield and John", the bare one is the other
      // John by elimination.
      const remaining = entry.contacts.filter((contact) => !taken.has(contact.id));
      if (remaining.length === 0) break;

      const matchedText = remainder.slice(at, at + entry.needle.length);
      remainder = (remainder.slice(0, at) + " " + remainder.slice(at + entry.needle.length))
        .replace(/\s{2,}/g, " ")
        .trim();

      if (remaining.length === 1) {
        taken.add(remaining[0].id);
        matched.push({ contact: remaining[0], matchedText });
      } else {
        // Several people answer to this name. Refusing to choose is the point:
        // filing a conversation against the wrong relative is both easy to do
        // and nearly impossible to spot afterwards.
        ambiguous.push({ matchedText, candidates: remaining });
        // Nothing was claimed, so the next occurrence would match the same
        // people forever. Stop after recording this one.
        break;
      }
    }
  }

  // Whatever is left that looks like a name — capitalised, not a stopword, not
  // at the very start where it is probably just a sentence opener.
  const unknownNames: string[] = [];
  const words = remainder.split(/\s+/);
  for (const [index, word] of words.entries()) {
    const bare = word.replace(/[^A-Za-z'-]/g, "");
    if (bare.length < 2) continue;
    if (STOPWORDS.has(bare.toLowerCase())) continue;
    if (bare[0] !== bare[0].toUpperCase()) continue;
    // A capitalised first word is usually just the start of the sentence.
    if (index === 0 && bare.toLowerCase() !== bare) continue;
    // A name the app already knows is never a stranger, even when it is left
    // over — a second "John" in "John and John" must not offer to create a
    // third one.
    if (byNeedle.has(bare.toLowerCase())) continue;
    if (!unknownNames.includes(bare)) unknownNames.push(bare);
  }

  return { contacts: matched, ambiguous, unknownNames, remainder };
}

// --- title and notes -------------------------------------------------------

function splitTitleAndNotes(
  remainder: string,
  type: ParseType | null,
  contacts: MatchedContact[],
): { title: string; notes: string | null } {
  // Everything after the first comma or dash is commentary, not a title.
  const split = remainder.match(/^([^,–—]*?)\s*(?:,|\s[–—-]\s)\s*(.+)$/);
  const head = (split ? split[1] : remainder).trim();
  const tail = split ? split[2].trim() : "";

  const cleaned = head
    .replace(/^\s*(?:with|and|at|to|for|from|on|in)\b/i, "")
    .replace(/\b(?:with|and)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();

  // A title is nice to have, not required. When the line was only a type and a
  // person — "coffee with Sarah" — say so rather than leaving it blank.
  const fallback = type
    ? contacts.length > 0
      ? `${type.label} with ${contacts.map((m) => m.contact.firstName).join(", ")}`
      : type.label
    : contacts.length > 0
      ? `Caught up with ${contacts.map((m) => m.contact.firstName).join(", ")}`
      : "";

  return {
    title: cleaned || fallback,
    notes: tail || null,
  };
}

// --- helpers for the caller ------------------------------------------------

/**
 * True while a name still matches more than one person.
 *
 * The confirm step is blocked on this: a quick add that guesses between two
 * relatives with the same first name is worse than one that asks.
 */
export function needsDisambiguation(result: QuickParseResult): boolean {
  return result.ambiguous.length > 0;
}

/** True when any matched person is private — the signal not to send anywhere. */
export function touchesPrivateContact(result: QuickParseResult): boolean {
  // Candidates count too: if any John is private, the line naming "John" must
  // not leave the box, whichever John you eventually pick.
  return (
    result.contacts.some((match) => match.contact.isPrivate === true) ||
    result.ambiguous.some((entry) =>
      entry.candidates.some((contact) => contact.isPrivate === true),
    )
  );
}

/** The parsed date as a form value, or today's when the line had no date. */
export function parsedDateKey(result: QuickParseResult, today: PlainDate): string {
  return plainDateKey(result.date ?? today);
}
