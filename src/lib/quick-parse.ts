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
  locationAliases?: { value: string }[];
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
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
  "we",
  "i",
  "me",
  "my",
  "our",
  "us",
  "she",
  "he",
  "they",
  "her",
  "him",
  "them",
  "his",
  "their",
  "had",
  "have",
  "has",
  "was",
  "were",
  "went",
  "got",
  "did",
  "saw",
  "met",
  "about",
  "up",
  "out",
  "over",
  "into",
  "then",
  "just",
  "also",
  "very",
  "really",
  "again",
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
  const {
    contacts,
    ambiguous,
    knownNeedles,
    remainder: withoutPeople,
    names,
  } = extractPeople(text, context.contacts);
  // Places before the type reader, or a venue called "The Coffee House" has
  // "coffee" torn out of its middle and stops matching.
  const known = matchKnownLocation(
    withoutPeople,
    context.locations,
    new Set(
      context.types.flatMap((type) => [
        type.label.trim().toLowerCase(),
        type.slug.replace(/-/g, " ").toLowerCase(),
      ]),
    ),
  );
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
  if (results.length === 0)
    return { date: null, dateText: null, withoutDate: text };

  // The longest match wins: "last Tuesday" beats "Tuesday".
  const best = results.reduce((a, b) =>
    b.text.length > a.text.length ? b : a,
  );
  const parsed = best.date();
  if (!Number.isFinite(parsed.getTime())) {
    return { date: null, dateText: null, withoutDate: text };
  }

  const withoutDate = (
    text.slice(0, best.index) +
    " " +
    text.slice(best.index + best.text.length)
  )
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    date: calendarDateInTz(parsed, timeZone),
    dateText: best.text,
    withoutDate,
  };
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
    for (const needle of [
      type.label.toLowerCase(),
      type.slug.replace(/-/g, " "),
    ]) {
      if (!needle) continue;
      const at = indexOfWord(lower, needle);
      if (at === -1) continue;
      const withoutType = (
        text.slice(0, at) +
        " " +
        text.slice(at + needle.length)
      )
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
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`,
    "i",
  );
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
  return (
    text
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
      .trim()
  );
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
/**
 * Where an interaction stops being where it happened and starts being notes.
 * The same boundary `splitTitleAndNotes` uses.
 */
const COMMENTARY_PATTERN = /,|\s[–—-]\s/;

export function matchKnownLocation(
  text: string,
  locations: ParseLocation[],
  /**
   * Names that mean something else as well — the account's own interaction
   * types. A place called "Coffee" or "Dinner" is a real thing to record, but
   * matching it with no cue stole the type out of "Coffee with Sarah". Those
   * need "at" before them to count as a venue.
   */
  alsoTypeNames: Set<string> = new Set(),
): { place: MatchedLocation | null; withoutPlace: string } {
  // Longest first, so "The Coffee House" wins over a place called "Coffee".
  const candidates = locations
    .flatMap((location) =>
      [location.name, ...(location.locationAliases ?? []).map((a) => a.value)]
        .filter(
          (name, index, names) => name.trim() && names.indexOf(name) === index,
        )
        .map((matchName) => ({ location, matchName })),
    )
    .sort((a, b) => b.matchName.length - a.matchName.length);

  // Only the part before the commentary is where an interaction happened.
  // Everything after the first comma or dash is notes — "Coffee with Sarah,
  // talked about Northside Cafe" happened wherever it happened, and reading a
  // venue out of the sentence about it also cut the note down to "talked
  // about". The same boundary `splitTitleAndNotes` uses.
  const commentary = text.search(COMMENTARY_PATTERN);
  const searchable = commentary === -1 ? text : text.slice(0, commentary);

  for (const { location, matchName } of candidates) {
    const words = matchName.trim().split(/\s+/).map(escapeRegExp);
    if (!words.length) continue;
    // Words joined by `\s+` rather than a literal space: the typed line may
    // have doubled spaces where the stored name does not, and that is exactly
    // the difference `normalizeLocationName` folds away.
    const pattern = new RegExp(
      `(?<![A-Za-z0-9])${words.join("\\s+")}(?![A-Za-z0-9])`,
      "i",
    );
    // A name that carries the boundary inside itself — "Washington, D.C." —
    // can never be found in `searchable`, which stops at the first comma, so
    // quick add proposed a brand new place called "Washington" instead of the
    // one the account already had. Those names are searched in the whole line
    // and accepted only if they *start* before the boundary: the venue is
    // still in the part before the notes, it merely spans a comma of its own.
    // Every other name keeps the narrow search, so "talked about Northside
    // Cafe" remains commentary rather than a venue.
    const spansCommentary = COMMENTARY_PATTERN.test(matchName);
    const found = pattern.exec(spansCommentary ? text : searchable);
    if (!found) continue;
    if (spansCommentary && commentary !== -1 && found.index > commentary)
      continue;

    const at = found.index;
    const matchedText = found[0];
    const preceding = searchable.slice(0, at);
    const hasVenueCue = /(?:\bat|@)\s*$/i.test(preceding);
    // Without a cue this name is more likely the type than the place.
    if (!hasVenueCue && alsoTypeNames.has(matchedText.trim().toLowerCase()))
      continue;

    // Swallow a preposition immediately before it, or the title keeps a
    // dangling "at" once the venue is gone. The boundary belongs to "at"
    // alone: "@" is not a word character, so `\b@` cannot match after a space
    // and the sign survived into the title as a one-character name.
    const before = text.slice(0, at).replace(/(?:\bat|@)\s*$/i, "");

    const withoutPlace = (
      before +
      PLACE_MASK +
      text.slice(at + matchedText.length)
    )
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
function prepositionalPlace(text: string): {
  place: MatchedLocation | null;
  withoutPlace: string;
} {
  // Every "at" in the line is tried, not just the first.
  //
  // Chrono removes a time phrase but leaves its preposition behind, so
  // "Coffee at noon with Sarah at Northside Cafe" still begins with a stray
  // "at". Committing to the earliest cue rejected the line on that one and
  // never looked at the real venue further along — which put "Northside" and
  // "Cafe" back in front of the user as people to create.
  const cues = text.matchAll(/(^|\s)(?:at\s+|@\s*)/gi);
  for (const cue of cues) {
    const found = venueAfterCue(
      text,
      cue.index + cue[1].length,
      cue.index + cue[0].length,
    );
    if (found) return found;
  }
  return { place: null, withoutPlace: text };
}

/**
 * The venue a single "at" introduces, or null when that cue leads nowhere.
 *
 * `cueStart` is where the preposition begins and `phraseStart` where the words
 * after it do; both are consumed together when this succeeds.
 */
function venueAfterCue(
  text: string,
  cueStart: number,
  phraseStart: number,
): { place: MatchedLocation; withoutPlace: string } | null {
  // Commentary after a comma or dash is notes, not part of the venue.
  const tail = text.slice(phraseStart).split(/\s*(?:,|\s[–—-]\s)/)[0];

  // A mask or a "with" ENDS the venue rather than disqualifying it. Rejecting
  // any phrase containing one looked equivalent and was not: in "Coffee at
  // Northside Cafe with Sarah" the participant sits *inside* the phrase, so the
  // whole venue was thrown away and its words came back as people to create —
  // pre-ticked, which is the exact harm this pass exists to stop. "with" covers
  // a participant the app has never seen, who leaves no mask; "and" does not,
  // because "Bar and Grill" is a venue rather than a guest.
  //
  // A mask at the very start still rejects, because that is the other shape:
  // "at Sarah's place" is somebody's home, not a venue.
  const stops = [
    tail.search(ANY_MASK_PATTERN),
    tail.search(/\swith\s/i),
  ].filter((index) => index !== -1);
  const cut = stops.length ? Math.min(...stops) : tail.length;
  // Trailing joining words are what led into the name we just stopped at.
  const phrase = tail
    .slice(0, cut)
    .replace(/\s+(?:with|and|for|to)\s*$/i, "")
    .trim();
  if (!phrase) return null;

  const words = phrase.split(/\s+/);
  if (words.length > 6) return null;

  // "at Bob's", "at Bob's afterwards" — a possessive names somebody's home, so
  // Bob is a person to offer, not a venue to create. The masked case ("at
  // Sarah's place") is already gone; this is the same rule for a name we do not
  // have yet. A real venue spelled possessively — "Joe's Diner" — is a false
  // negative you type once, and pass 1 matches it ever after.
  if (/['\u2019](?:s\b|(?![a-z0-9]))/i.test(words[0])) return null;

  const namesSomewhere = words.some((word) => {
    const bare = word.replace(/[^A-Za-z'\u2019-]/g, "");
    return (
      bare.length >= 2 &&
      bare[0] === bare[0].toUpperCase() &&
      !STOPWORDS.has(bare.toLowerCase())
    );
  });
  if (!namesSomewhere) return null;

  // Consume the preposition and everything up to where the venue stopped,
  // leaving the participant mask and any notes after a comma in place.
  const withoutPlace = (
    text.slice(0, cueStart) +
    PLACE_MASK +
    text.slice(phraseStart + cut)
  )
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    place: { location: null, matchedText: phrase, via: "preposition" },
    withoutPlace,
  };
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
  const byNeedle = new Map<
    string,
    { needle: string; contacts: ParseContact[] }
  >();
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
    offer(
      contact,
      [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    );
    if (contact.nickname) offer(contact, contact.nickname);
    offer(contact, contact.firstName);
  }

  const ordered = [...byNeedle.values()].sort(
    (a, b) => b.needle.length - a.needle.length,
  );

  for (const entry of ordered) {
    // Looped, not matched once: "dinner with John and John" is two people, and
    // consuming only the first would leave the second looking like a stranger
    // and offer to create a third John. The cursor only ever moves forward,
    // because a masked name stays in the string and would otherwise match
    // itself for ever.
    let cursor = 0;
    for (;;) {
      const at = indexOfWord(
        remainder.toLowerCase(),
        entry.needle.toLowerCase(),
        cursor,
      );
      if (at === -1) break;

      // Anyone already pinned down by a longer, more specific name is out of
      // the running — in "John Whitfield and John", the bare one is the other
      // John by elimination.
      const remaining = entry.contacts.filter(
        (contact) => !taken.has(contact.id),
      );
      if (remaining.length === 0) break;

      const end = at + entry.needle.length;
      const matchedText = remainder.slice(at, end);

      if (names.length >= NAME_MASK_LIMIT) break;
      const mask = maskFor(names.length);
      names.push({
        text: matchedText,
        possessive: possessiveAt(remainder, end),
      });
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
function unknownNamesIn(
  remainder: string,
  knownNeedles: Set<string>,
): string[] {
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
export function parsedDateKey(
  result: QuickParseResult,
  today: PlainDate,
): string {
  return plainDateKey(result.date ?? today);
}
