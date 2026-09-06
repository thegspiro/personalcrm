/**
 * Reading vCard, which is how most people's contacts already exist.
 *
 * Exporting from a phone, Google or iCloud gives a `.vcf`, so this is the
 * realistic first hour for anyone adopting the app — the alternative being to
 * type several hundred people in by hand.
 *
 * The parser is deliberate about three things the format makes easy to get
 * wrong: lines are unfolded before anything else is looked at, a value is split
 * on its structural semicolons *before* those parts are unescaped (doing it the
 * other way round turns an escaped semicolon inside a name into a field
 * boundary), and a birthday is read at whatever accuracy it was written with.
 * That last one is the reason this is worth writing rather than borrowing: a
 * `--0415` birthday means April the fifteenth, year not stated, and importing
 * it as 1904 or as this year would be the confident lie the whole app is
 * arranged to avoid.
 */
import { type DatePrecision, UNKNOWN_YEAR } from "@/lib/date-precision";
import type { PlainDate } from "@/lib/dates";
import { emptyContact, type ImportedContact, type ParseResult, type ParsedRow } from "./types";

interface Property {
  name: string;
  params: Map<string, string>;
  value: string;
}

/**
 * Undo the folding, and normalise line endings while we are here.
 *
 * A continuation is CRLF followed by one space or tab. Real files arrive with
 * bare LF at least as often as CRLF, so both are accepted; a file that only a
 * strict reader would reject is still a file somebody needs to import.
 */
export function unfold(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");

  // Quoted-printable wraps with a trailing `=` and *no* leading whitespace on
  // the next line, so the fold above never joins it. Left alone, `Jos=C3=` and
  // `=A9` stay two lines: the second parses as nothing and is dropped, and the
  // first decodes to half a character. Joining has to happen before any value
  // is read, and only for a line that declares the encoding — a plain value
  // ending in `=` is a value ending in `=`.
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && previous.endsWith("=") && declaresQuotedPrintable(previous)) {
      joined[joined.length - 1] = previous.slice(0, -1) + line;
      continue;
    }
    joined.push(line);
  }
  return joined;
}

/** Whether a content line's parameters ask for quoted-printable. */
function declaresQuotedPrintable(line: string): boolean {
  const colon = line.indexOf(":");
  const head = colon === -1 ? line : line.slice(0, colon);
  return /;\s*encoding\s*=\s*"?quoted-printable"?/i.test(head);
}

/** Undo the escaping the format applies inside a value. */
export function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[i + 1];
    if (next === undefined) break;
    // `\n` and `\N` both mean a line break; everything else escapes itself.
    out += next === "n" || next === "N" ? "\n" : next;
    i += 1;
  }
  return out;
}

/**
 * Split a structured value on its field separators, leaving escapes alone.
 *
 * Called before unescaping, never after: `Kim\; Jr` is one field containing a
 * semicolon, and a split that ran on the unescaped text would make it two.
 */
export function splitStructured(value: string, separator = ";"): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\") {
      current += char + (value[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (char === separator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Read one content line into its name, parameters and value.
 *
 * The value is everything after the first colon that is not inside a quoted
 * parameter — a URL's `https://` would otherwise end the value at `https`.
 */
/** Split a parameter list on its semicolons, ignoring any inside quotes. */
function splitParameters(head: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of head) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

export function parseProperty(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  // Quote-aware, for the same reason the colon search above is: a parameter
  // may legitimately hold a delimiter inside quotes, and this export writes
  // one — `ADR;LABEL="Parents; holiday"`. Splitting blind cuts the label in
  // half and turns its tail into a parameter of its own.
  const [rawName, ...rawParams] = splitParameters(head);
  if (!rawName) return null;

  const params = new Map<string, string>();
  for (const param of rawParams) {
    const equals = param.indexOf("=");
    if (equals === -1) {
      // vCard 2.1 wrote bare types, e.g. `TEL;CELL;VOICE:...`, and plenty of
      // exporters still do. They accumulate rather than overwrite: keeping
      // only the last would read `TEL;CELL;VOICE` as a voice line and file a
      // mobile number as a landline.
      const existing = params.get("TYPE");
      const token = param.trim().toLowerCase();
      params.set("TYPE", existing ? `${existing} ${token}` : token);
      continue;
    }
    const key = param.slice(0, equals).trim().toUpperCase();
    const raw = param.slice(equals + 1).replace(/^"|"$/g, "").trim();
    // TYPE and ENCODING are controlled vocabularies, so they are compared in
    // lower case. Everything else may be free text a person wrote — LABEL
    // above all — and lower-casing it would hand back "parents" for the
    // address they labelled "Parents".
    const value = key === "TYPE" || key === "ENCODING" ? raw.toLowerCase() : raw;
    // A TYPE written the modern way may still carry several comma-separated
    // values, and it may appear beside bare tokens.
    if (key === "TYPE") {
      const existing = params.get("TYPE");
      params.set("TYPE", existing ? `${existing} ${value}` : value);
      continue;
    }
    params.set(key, value);
  }

  // The property name may be prefixed with a group, as in `item1.TEL`.
  const name = rawName.includes(".") ? rawName.slice(rawName.lastIndexOf(".") + 1) : rawName;
  return { name: name.trim().toUpperCase(), params, value };
}

/**
 * A birthday at whatever accuracy it was written with.
 *
 * The mirror of what the export writes. Accepts the ISO 8601 reduced-accuracy
 * forms the format permits, with or without hyphens, and refuses anything it
 * cannot read rather than guessing at it.
 */
export function parseVCardDate(raw: string): { date: PlainDate; precision: DatePrecision } | null {
  const value = raw.trim();
  // Year absent: `--0415` or `--04-15`.
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
  if (noYear) {
    const month = Number(noYear[1]);
    const day = Number(noYear[2]);
    if (!valid(month, day)) return null;
    // The sentinel the rest of the app uses for a year nobody supplied.
    return { date: { year: UNKNOWN_YEAR, month, day }, precision: "MONTH_DAY" };
  }

  const full = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  if (full) {
    const [year, month, day] = [Number(full[1]), Number(full[2]), Number(full[3])];
    if (!valid(month, day, year)) return null;
    return { date: { year, month, day }, precision: "DAY" };
  }

  // Year and month, which the format requires a hyphen for.
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(value);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return null;
    return { date: { year: Number(yearMonth[1]), month, day: 1 }, precision: "MONTH" };
  }

  const yearOnly = /^(\d{4})$/.exec(value);
  if (yearOnly) {
    return { date: { year: Number(yearOnly[1]), month: 1, day: 1 }, precision: "YEAR" };
  }

  return null;
}

/**
 * Whether this really is a day in that month.
 *
 * Checking only 1–31 lets `19900231` through, and it is then normalised into
 * the twenty-eighth on the way to the database — turning malformed source data
 * into confident, wrong account data. Refusing it leaves the contact with no
 * birthday, which is what the file actually said.
 *
 * February is allowed 29 whatever the year, because a year-less birthday
 * carries a placeholder year that says nothing about leap years.
 */
function valid(month: number, day: number, year?: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && year !== undefined && day === 29) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap;
  }
  return day <= lengths[month - 1]!;
}

/** Which contact-method slug a vCard property and its TYPE correspond to. */
function methodSlug(property: string, type: string | undefined): string | null {
  if (property === "EMAIL") return "email";
  // The shipped term is `website`; `url` resolves to nothing, which would
  // leave the method untyped and demote it to a NOTE on the way back out.
  if (property === "URL") return "website";
  if (property === "TEL") {
    if (type?.includes("cell") || type?.includes("mobile")) return "mobile";
    if (type?.includes("work")) return "work-phone";
    return "home-phone";
  }
  return null;
}

/**
 * Undo quoted-printable, which vCard 2.1 exporters use for anything non-ASCII.
 *
 * Without this a name arrives as the literal `Jos=C3=A9`. Decoding is done on
 * bytes and then read as UTF-8, because one accented character is two or three
 * `=XX` pairs and decoding them one at a time produces mojibake rather than the
 * name.
 */
export function decodeQuotedPrintable(value: string, charset = "utf-8"): string {
  // A trailing `=` is a soft line break; the folding has already been undone,
  // so it carries no meaning here.
  const text = value.replace(/=$/, "");
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "=" && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    // Anything not part of an escape is already a literal, and ASCII here.
    for (const byte of new TextEncoder().encode(text[i]!)) bytes.push(byte);
  }
  return decodeBytes(new Uint8Array(bytes), charset);
}

/**
 * Read bytes as the charset the file declared, falling back to UTF-8.
 *
 * vCard 2.1 predates the assumption that everything is UTF-8 and says so in a
 * parameter: `CHARSET=ISO-8859-1` beside a quoted-printable value is ordinary
 * in files from that era. Decoding those bytes as UTF-8 turns André into
 * Andr\uFFFD. An unknown label is not fatal — TextDecoder throws on one, and a
 * name read with the wrong alphabet still beats no contact at all.
 */
function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeIfNeeded(property: Property, raw: string): string {
  return property.params.get("ENCODING")?.includes("quoted-printable")
    ? decodeQuotedPrintable(raw, property.params.get("CHARSET") ?? "utf-8")
    : raw;
}

function firstValue(text: string): string {
  return unescapeValue(text).trim();
}

/** One decoded, unescaped value. */
function singleValue(property: Property): string {
  return firstValue(decodeIfNeeded(property, property.value));
}

/**
 * A structured value's components, split before any decoding.
 *
 * The same ordering the escapes need, and for the same reason. vCard 2.1
 * writes a literal semicolon inside a component as `=3B`, so decoding the
 * whole value first makes it indistinguishable from the separators — and
 * `N;ENCODING=QUOTED-PRINTABLE:Doe=3B Jr.;John;;;` becomes a person whose
 * first name is "Jr." and whose given name has been thrown away.
 */
function structuredValues(property: Property, separator = ";"): string[] {
  return splitStructured(property.value, separator).map((part) =>
    firstValue(decodeIfNeeded(property, part)),
  );
}

/** Strip the URI scheme a vCard 4.0 telephone or email may be written with. */
export function stripScheme(value: string): string {
  return value.replace(/^(tel|mailto):/i, "").trim();
}

/** Read one card. Returns null when it carries no name to file it under. */
function cardToContact(lines: readonly string[]): ImportedContact | null {
  const contact = emptyContact();
  let formattedName = "";
  // Resolved after the loop: Apple writes the marker as a parameter on BDAY on
  // some versions and as a property of its own on others, and the property may
  // arrive before or after the birthday it qualifies.
  let birthday: { raw: string; omitYear: string | null } | null = null;
  let omitYearProperty: string | null = null;

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    switch (property.name) {
      case "FN":
        formattedName = singleValue(property);
        break;
      case "N": {
        // family;given;additional;prefix;suffix
        const parts = structuredValues(property);
        contact.lastName = parts[0] || null;
        contact.firstName = parts[1] || "";
        break;
      }
      case "NICKNAME":
        contact.nickname = structuredValues(property, ",")[0] || null;
        break;
      case "BDAY":
        birthday = {
          raw: property.value,
          omitYear: property.params.get("X-APPLE-OMIT-YEAR") ?? null,
        };
        break;
      case "X-APPLE-OMIT-YEAR":
        omitYearProperty = property.value.trim();
        break;
      case "ORG":
        // Organisation is structured; the first part is the company itself.
        contact.employer = structuredValues(property)[0] || null;
        break;
      case "TITLE":
        contact.occupation = singleValue(property) || null;
        break;
      case "NOTE":
        contact.summary = singleValue(property) || null;
        break;
      case "EMAIL":
      case "TEL":
      case "URL": {
        const slug = methodSlug(property.name, property.params.get("TYPE"));
        const value = stripScheme(singleValue(property));
        if (slug && value) {
          contact.methods.push({ slug, value, label: property.params.get("TYPE") ?? null });
        }
        break;
      }
      case "ADR": {
        const parts = structuredValues(property);
        // parts[0] is the post-office box. Skipping it discards a box-only
        // address entirely and silently drops the box from one that also has a
        // street, so it joins the second line rather than being thrown away.
        const extended = [parts[0], parts[1]].filter(Boolean).join(", ");
        const address = {
          // What this export writes for a free-text label, so a card that left
          // this app comes back with the label it left with. TYPE only ever
          // carries the two standard values, and is the fallback.
          label: property.params.get("LABEL") ?? property.params.get("TYPE") ?? null,
          line1: parts[2] || null,
          line2: extended || null,
          city: parts[3] || null,
          region: parts[4] || null,
          postalCode: parts[5] || null,
          country: parts[6] || null,
        };
        // An ADR of nothing but separators is what exporters emit for an
        // address someone started and never filled in.
        if (Object.values(address).some((part, i) => i > 0 && part)) {
          contact.addresses.push(address);
        }
        break;
      }
    }
  }

  if (birthday) {
    const parsed = parseVCardDate(birthday.raw);
    if (parsed) {
      // Apple stores a year-less birthday as a real date on a placeholder year
      // — 1604 — and says so in a marker naming that year. Taking the date at
      // face value files everyone born on an unknown year as a Jacobean, and
      // does it confidently, at DAY precision.
      const omit = birthday.omitYear ?? omitYearProperty;
      const omitted = omit !== null && Number(omit) === parsed.date.year;
      contact.birthDate = omitted
        ? { year: UNKNOWN_YEAR, month: parsed.date.month, day: parsed.date.day }
        : parsed.date;
      contact.birthDatePrecision = omitted ? "MONTH_DAY" : parsed.precision;
    }
  }

  if (!contact.firstName && formattedName) {
    // No structured name, which is common from web exporters. The formatted
    // name is split on the last space: imperfect for compound surnames, and
    // better than filing everyone under a blank.
    const cut = formattedName.lastIndexOf(" ");
    if (cut === -1) {
      contact.firstName = formattedName;
      // `N:Doe;;;;` with `FN:Doe` already put the one name in lastName, and
      // copying it into firstName as well files the person as "Doe Doe".
      if (contact.lastName === formattedName) contact.lastName = null;
    } else {
      contact.firstName = formattedName.slice(0, cut);
      contact.lastName = contact.lastName ?? formattedName.slice(cut + 1);
    }
  }

  return contact.firstName ? contact : null;
}

/** Read a whole file. */
export function parseVCard(text: string, limit?: number): ParseResult {
  const lines = unfold(text);
  const rows: ParsedRow[] = [];

  let current: string[] | null = null;
  let index = 0;

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      current = [];
      continue;
    }
    if (upper === "END:VCARD") {
      if (current) {
        index += 1;
        const contact = cardToContact(current);
        rows.push({
          index,
          contact,
          problem: contact ? null : "No name on this card, so there is nothing to file it under.",
        });
      }
      current = null;
      // One past the cap is enough for the caller to say "too many"; going on
      // would build a contact object per card for a file already refused.
      if (limit !== undefined && rows.length > limit) break;
      continue;
    }
    current?.push(line);
  }

  if (rows.length === 0) {
    return { rows, fileProblem: "No vCards found. Is this a .vcf file?" };
  }
  return { rows, fileProblem: null };
}
