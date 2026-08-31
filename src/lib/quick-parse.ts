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

export interface ParseLocation {
  id: string;
  name: string;
}

/**
 * Where the line said it happened.
 *
 * `location` is null when the words named somewhere not yet recorded — the
 * proposal is still worth surfacing, because it is confirmed before anything
 * is written and `resolveLocation` get-or-creates from the name either way.
 */
export interface MatchedLocation {
  location: ParseLocation | null;
  /** The words in the input that named it, exactly as written. */
  matchedText: string;
  /** How it was found, so the confirm step can be honest about it. */
  via: "known" | "preposition";
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
  /** Where it happened. One place, because an interaction has one. */
  place: MatchedLocation | null;
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
  context: {
    contacts: ParseContact[];
    types: ParseType[];
    locations: ParseLocation[];
    now: Date;
    timeZone: string;
  },
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
      place: null,
      title: "",
      notes: null,
    };
  }

  // People first, deliberately. Plenty of real names are also dates — April,
  // May, June — and letting the date parser run first would swallow the person
  // and file the interaction against nobody. A name you have recorded always
  // wins over a date reading of the same word.
  const { contacts, ambiguous, knownNeedles, remainder: withoutPeople, names } = extractPeople(
    text,
    context.contacts,
  );
  // Places before the type reader, or a venue called "The Coffee House" has
  // "coffee" torn out of its middle and stops matching.
  const known = matchKnownLocation(withoutPeople, context.locations);
  const { type, withoutType } = extractType(known.withoutPlace, context.types);
  const { date, dateText, withoutDate } = extractDate(
    withoutType,
    context.now,
    context.timeZone,
  );
  // A venue we have never seen is proposed only after chrono has had its turn,
  // so "at Northside Cafe yesterday" does not take the date into the name. It
  // also has to run while names are still masked: "at Sarah's place" is a
  // person's home, not a place to record.
  const proposed = known.place ? known : prepositionalPlace(withoutDate);
  const withoutAnyPlace = known.place ? withoutDate : proposed.withoutPlace;

  // Strangers are decided last, once every reader has taken its words out.
  const unknownNames = unknownNamesIn(withoutAnyPlace, knownNeedles);

  // Names come back only once the date and type readers have had their turn on
  // text that cannot mislead them — see `NAME_MASK`.
  const { title, notes } = splitTitleAndNotes(
    restoreNames(withoutAnyPlace, names),
    type,
    contacts,
  );

  return {
    contacts,
    ambiguous,
    unknownNames,
    type,
    date,
    dateText,
    place: proposed.place,
    title,
    notes,
  };
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

/**
 * Index of `needle` in `haystack` on word boundaries at or after `from`, or -1.
 *
 * The offset is what lets the people scanner move forward over a name it has
 * already dealt with. Slicing is safe because every offset it passes sits on a
 * boundary the scanner just created.
 */
function indexOfWord(haystack: string, needle: string, from = 0): number {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, "i");
  const match = pattern.exec(haystack.slice(from));
  if (!match) return -1;
  return from + match.index + (match[1] ? match[1].length : 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- people ----------------------------------------------------------------

/**
 * The stand-in left behind wherever a name was recognised.
 *
 * Names are masked rather than cut out because the two readers that run next
 * must not see them: "at April's place" would otherwise hand chrono a month
 * and file the evening under 1 April. Private-use characters carry no letters
 * or digits, so nothing downstream can read anything into them, and each mask
 * carries its own index so a name is restored to the exact spot it came from.
 */
const NAME_MASK = "\ue000";
const NAME_MASK_FIRST = 0xe100;
const NAME_MASK_LIMIT = 0x100;
const NAME_MASK_PATTERN = /\ue000([\ue100-\ue1ff])/g;

interface MaskedName {
  text: string;
  /**
   * True when the name is doing grammatical work rather than only naming a
   * participant — "at Sarah's place". Those come back into the title; a plain
   * "coffee with Sarah" does not, because the fallback already says it better.
   */
  possessive: boolean;
}

function maskFor(index: number): string {
  return NAME_MASK + String.fromCharCode(NAME_MASK_FIRST + index);
}

/**
 * The stand-in left where a place was recognised.
 *
 * A separate marker and index range from `NAME_MASK` so the two can never be
 * confused: a place is dropped rather than restored, since it leaves the title
 * for its own field, while a possessive name has to come back.
 */
const PLACE_MASK = "\ue002";
const PLACE_MASK_PATTERN = /\ue002/g;

/** Anything either masker left behind. Nothing else may look like a word. */
const ANY_MASK_PATTERN = /[\ue000-\ue3ff]/;

/**
 * True when what follows a name is a possessive ending — "Sarah's place", or
 * "Chris' place" for a name that already ends in s.
 */
function possessiveAt(text: string, index: number): boolean {
  return /^['\u2019](?:s\b|(?![a-z0-9]))/i.test(text.slice(index));
}

/** Put the possessive names back and drop the masks left by the rest. */
function restoreNames(text: string, names: MaskedName[]): string {
  return text
    .replace(NAME_MASK_PATTERN, (_match, marker: string) => {
      const name = names[marker.charCodeAt(0) - NAME_MASK_FIRST];
      // A space, not an empty string: cutting "Sarah" out of "coffee with
      // Sarah and John" must not weld "with" onto "and".
      return name?.possessive ? name.text : " ";
    })
    // A place never comes back: it has its own field now, and leaving it in
    // would put the venue in the title as well.
    .replace(PLACE_MASK_PATTERN, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// --- places ----------------------------------------------------------------

/**
 * A place the account already has, matched the way people are.
 *
 * Runs on the people-masked text, which is what gives a person precedence over
 * a place named after one: with a contact "Sarah" recorded, "Sarah's Diner" can
 * no longer match, because "Sarah" is already a mask by the time we look.
 *
 * Only the first hit is taken — an interaction happens in one place.
 */
export function matchKnownLocation(
  text: string,
  locations: ParseLocation[],
): { place: MatchedLocation | null; withoutPlace: string } {
  // Longest first, so "The Coffee House" wins over a place called "Coffee".
  const candidates = [...locations]
    .filter((location) => location.name.trim())
    .sort((a, b) => b.name.length - a.name.length);

  for (const location of candidates) {
    const words = location.name.trim().split(/\s+/).map(escapeRegExp);
    if (!words.length) continue;
    // Words joined by `\s+` rather than a literal space: the typed line may
    // have doubled spaces where the stored name does not, and that is exactly
    // the difference `normalizeLocationName` folds away.
    const pattern = new RegExp(`(?<![A-Za-z0-9])${words.join("\\s+")}(?![A-Za-z0-9])`, "i");
    const found = pattern.exec(text);
    if (!found) continue;

    const at = found.index;
    const matchedText = found[0];
    // Swallow a preposition immediately before it, or the title keeps a
    // dangling "at" once the venue is gone.
    const before = text.slice(0, at).replace(/\b(?:at|@)\s*$/i, "");

    const withoutPlace = (before + PLACE_MASK + text.slice(at + matchedText.length))
      .replace(/\s{2,}/g, " ")
      .trim();

    return { place: { location, matchedText, via: "known" }, withoutPlace };
  }

  return { place: null, withoutPlace: text };
}

/**
 * A place we have never seen, proposed from an "at ..." cue.
 *
 * Deliberately not "in" — "in 2019", "in the morning" — and not "to", which is
 * nearly always "talked to". The guard that does the real work is requiring a
 * capitalised word that is not a stopword: it is what separates "at Northside
 * Cafe" from "at home" and "at the office". A false negative costs you typing
 * the venue yourself; a false positive creates a junk place.
 */
function prepositionalPlace(
  text: string,
): { place: MatchedLocation | null; withoutPlace: string } {
  const match = /(^|\s)(?:at|@)\s+(.+)$/i.exec(text);
  if (!match) return { place: null, withoutPlace: text };

  const start = match.index + match[1].length;
  // Commentary after a comma or dash is notes, not part of the venue.
  const phrase = match[2].split(/\s*(?:,|\s[–—-]\s)/)[0].trim();
  if (!phrase) return { place: null, withoutPlace: text };

  // A mask means the phrase leans on a name or a place already taken —
  // "at Sarah's place" must not become a venue called "Sarah's place".
  if (ANY_MASK_PATTERN.test(phrase)) return { place: null, withoutPlace: text };

  const words = phrase.split(/\s+/);
  if (words.length > 6) return { place: null, withoutPlace: text };

  // "at Bob's", "at Bob's afterwards" — a possessive names somebody's home, so
  // Bob is a person to offer, not a venue to create. The masked case ("at
  // Sarah's place") is already gone; this is the same rule for a name we do not
  // have yet. A real venue spelled possessively — "Joe's Diner" — is a false
  // negative you type once, and pass 1 matches it ever after.
  if (/['’](?:s\b|(?![a-z0-9]))/i.test(words[0])) {
    return { place: null, withoutPlace: text };
  }

  const namesSomewhere = words.some((word) => {
    const bare = word.replace(/[^A-Za-z'’-]/g, "");
    return (
      bare.length >= 2 && bare[0] === bare[0].toUpperCase() && !STOPWORDS.has(bare.toLowerCase())
    );
  });
  if (!namesSomewhere) return { place: null, withoutPlace: text };

  // Consume the preposition and the phrase together, leaving whatever followed
  // (the notes after a comma) in place.
  const phraseStart = match.index + match[0].length - match[2].length;
  const withoutPlace = (text.slice(0, start) + PLACE_MASK + text.slice(phraseStart + phrase.length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { place: { location: null, matchedText: phrase, via: "preposition" }, withoutPlace };
}

function extractPeople(
  text: string,
  contacts: ParseContact[],
): {
  contacts: MatchedContact[];
  ambiguous: AmbiguousName[];
  /** Every spelling that matched somebody, so a leftover one is not a stranger. */
  knownNeedles: Set<string>;
  remainder: string;
  names: MaskedName[];
} {
  const matched: MatchedContact[] = [];
  const ambiguous: AmbiguousName[] = [];
  const names: MaskedName[] = [];
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
    // and offer to create a third John. The cursor only ever moves forward,
    // because a masked name stays in the string and would otherwise match
    // itself for ever.
    let cursor = 0;
    for (;;) {
      const at = indexOfWord(remainder.toLowerCase(), entry.needle.toLowerCase(), cursor);
      if (at === -1) break;

      // Anyone already pinned down by a longer, more specific name is out of
      // the running — in "John Whitfield and John", the bare one is the other
      // John by elimination.
      const remaining = entry.contacts.filter((contact) => !taken.has(contact.id));
      if (remaining.length === 0) break;

      const end = at + entry.needle.length;
      const matchedText = remainder.slice(at, end);

      if (names.length >= NAME_MASK_LIMIT) break;
      const mask = maskFor(names.length);
      names.push({ text: matchedText, possessive: possessiveAt(remainder, end) });
      remainder = remainder.slice(0, at) + mask + remainder.slice(end);
      cursor = at + mask.length;

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

  return {
    contacts: matched,
    ambiguous,
    knownNeedles: new Set(byNeedle.keys()),
    remainder,
    names,
  };
}

/**
 * Whatever is left that looks like a name — capitalised, not a stopword, not at
 * the very start where it is probably just a sentence opener.
 *
 * Runs LAST, on text the type, date and place readers have already taken their
 * words out of. It used to run inside `extractPeople`, which meant every word
 * those readers were about to claim was still standing: "coffee with Sarah
 * Tuesday" offered to create a contact called "Tuesday", "dinner in Boston"
 * offered "Boston", and "coffee with Sarah at Northside Cafe" offered both
 * "Northside" and "Cafe" — pre-ticked, so confirming the line created them.
 */
function unknownNamesIn(remainder: string, knownNeedles: Set<string>): string[] {
  const unknownNames: string[] = [];
  const words = remainder.split(/\s+/);
  for (const [index, word] of words.entries()) {
    const bare = word
      .replace(/[^A-Za-z'\u2019-]/g, "")
      // "Sarah's" is Sarah. Without this the possessive left standing in the
      // title reads as a stranger, and quick add offers to create a contact
      // literally called "Sarah's".
      .replace(/['\u2019]s?$/i, "");
    if (bare.length < 2) continue;
    // Masks leave punctuation behind; a name starts with a letter.
    if (!/^[A-Za-z]/.test(bare)) continue;
    if (STOPWORDS.has(bare.toLowerCase())) continue;
    if (bare[0] !== bare[0].toUpperCase()) continue;
    // A capitalised first word is usually just the start of the sentence.
    if (index === 0 && bare.toLowerCase() !== bare) continue;
    // A name the app already knows is never a stranger, even when it is left
    // over — a second "John" in "John and John" must not offer to create a
    // third one.
    if (knownNeedles.has(bare.toLowerCase())) continue;
    if (!unknownNames.includes(bare)) unknownNames.push(bare);
  }
  return unknownNames;
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
    // Any dangling preposition, not just "with"/"and": once the venue moves to
    // its own field, "Coffee with Sarah at" would otherwise keep the "at".
    .replace(/\b(?:with|and|at|to|for|from|on|in)\s*$/i, "")
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
