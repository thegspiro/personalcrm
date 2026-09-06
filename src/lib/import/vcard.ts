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
import type { DatePrecision } from "@/lib/date-precision";
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
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
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
  const [rawName, ...rawParams] = splitStructured(head);
  if (!rawName) return null;

  const params = new Map<string, string>();
  for (const param of rawParams) {
    const equals = param.indexOf("=");
    if (equals === -1) {
      // vCard 2.1 wrote a bare type, e.g. `TEL;CELL:...`, and plenty of
      // exporters still do. Reading it as a TYPE keeps those files usable.
      params.set("TYPE", param.trim().toLowerCase());
      continue;
    }
    params.set(
      param.slice(0, equals).trim().toUpperCase(),
      param.slice(equals + 1).replace(/^"|"$/g, "").trim().toLowerCase(),
    );
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
    return { date: { year: 1904, month, day }, precision: "MONTH_DAY" };
  }

  const full = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  if (full) {
    const [year, month, day] = [Number(full[1]), Number(full[2]), Number(full[3])];
    if (!valid(month, day)) return null;
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

function valid(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Which contact-method slug a vCard property and its TYPE correspond to. */
function methodSlug(property: string, type: string | undefined): string | null {
  if (property === "EMAIL") return "email";
  if (property === "URL") return "url";
  if (property === "TEL") {
    if (type?.includes("cell") || type?.includes("mobile")) return "mobile";
    if (type?.includes("work")) return "work-phone";
    return "home-phone";
  }
  return null;
}

function firstValue(text: string): string {
  return unescapeValue(text).trim();
}

/** Read one card. Returns null when it carries no name to file it under. */
function cardToContact(lines: readonly string[]): ImportedContact | null {
  const contact = emptyContact();
  let formattedName = "";

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    switch (property.name) {
      case "FN":
        formattedName = firstValue(property.value);
        break;
      case "N": {
        // family;given;additional;prefix;suffix
        const parts = splitStructured(property.value).map(firstValue);
        contact.lastName = parts[0] || null;
        contact.firstName = parts[1] || "";
        break;
      }
      case "NICKNAME":
        contact.nickname = splitStructured(property.value, ",").map(firstValue)[0] || null;
        break;
      case "BDAY": {
        const parsed = parseVCardDate(property.value);
        if (parsed) {
          contact.birthDate = parsed.date;
          contact.birthDatePrecision = parsed.precision;
        }
        break;
      }
      case "ORG":
        // Organisation is structured; the first part is the company itself.
        contact.employer = splitStructured(property.value).map(firstValue)[0] || null;
        break;
      case "TITLE":
        contact.occupation = firstValue(property.value) || null;
        break;
      case "NOTE":
        contact.summary = firstValue(property.value) || null;
        break;
      case "EMAIL":
      case "TEL":
      case "URL": {
        const slug = methodSlug(property.name, property.params.get("TYPE"));
        const value = firstValue(property.value);
        if (slug && value) {
          contact.methods.push({ slug, value, label: property.params.get("TYPE") ?? null });
        }
        break;
      }
      case "ADR": {
        const parts = splitStructured(property.value).map(firstValue);
        const address = {
          label: property.params.get("TYPE") ?? null,
          line1: parts[2] || null,
          line2: parts[1] || null,
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

  if (!contact.firstName && formattedName) {
    // No structured name, which is common from web exporters. The formatted
    // name is split on the last space: imperfect for compound surnames, and
    // better than filing everyone under a blank.
    const cut = formattedName.lastIndexOf(" ");
    if (cut === -1) {
      contact.firstName = formattedName;
    } else {
      contact.firstName = formattedName.slice(0, cut);
      contact.lastName = contact.lastName ?? formattedName.slice(cut + 1);
    }
  }

  return contact.firstName ? contact : null;
}

/** Read a whole file. */
export function parseVCard(text: string): ParseResult {
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
      continue;
    }
    current?.push(line);
  }

  if (rows.length === 0) {
    return { rows, fileProblem: "No vCards found. Is this a .vcf file?" };
  }
  return { rows, fileProblem: null };
}
