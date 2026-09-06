/**
 * Reading CSV, per RFC 4180 — the other way people's contacts already exist.
 *
 * Two jobs that are worth keeping apart: turning the text into rows of fields,
 * which is fiddly and entirely mechanical, and deciding what those fields
 * mean, which depends on whose exporter wrote the header.
 */
import type { DatePrecision } from "@/lib/date-precision";
import { emptyContact, type ImportedContact, type ParseResult, type ParsedRow } from "./types";
import { parseVCardDate } from "./vcard";

/**
 * Split the text into rows of fields.
 *
 * A quoted field may contain commas, quotes (doubled) and line breaks, which
 * is why this cannot be `split("\n")` followed by `split(",")` — a note
 * containing a newline would silently become two malformed rows.
 */
export function parseCsvRows(text: string, limit?: number): string[][] {
  // Excel and our own export both write a byte-order mark; left in place it
  // becomes part of the first header name and no column matches.
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Stop scanning once past the cap rather than materialising the file and
  // measuring it afterwards. Five megabytes of `a\n` is two and a half million
  // rows, and building them all to then refuse the request spends the memory
  // the cap exists to protect. One row past the limit is kept so the caller
  // can still tell "too many" from "exactly the maximum".
  const ceiling = limit === undefined ? Infinity : limit + 1;
  const keep = (entry: string[]) => {
    if (entry.some((value) => value.trim() !== "")) rows.push(entry);
    return rows.length < ceiling;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break rather than as an empty row between them.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      const room = keep(row);
      row = [];
      field = "";
      if (!room) return rows;
    } else {
      field += char;
    }
  }

  // Whatever is still in hand when the text runs out is a final row, unless
  // the file simply ended with a line break.
  if (field !== "" || row.length > 0) {
    row.push(field);
    keep(row);
  }

  return rows;
}

/**
 * Header names this understands, lowercased with punctuation stripped.
 *
 * Our own export first, then what Google and Outlook write, because those are
 * the files people actually have. An unrecognised column is ignored rather
 * than guessed at.
 */
const COLUMNS: Record<string, ReadonlyArray<string>> = {
  firstName: ["first name", "firstname", "first_name", "given name", "given_name"],
  lastName: ["last name", "lastname", "last_name", "family name", "surname"],
  nickname: ["nickname", "nick name"],
  // The numbered spellings — `E-mail 1 - Value` and friends — are deliberately
  // absent: `mapGroupedColumns` owns those, because it can also read the
  // `- Type` column beside them and the later groups this mapping cannot hold.
  // Listing them here as well made the single-column reading win the race and
  // file every Google phone number as a landline.
  email: ["email", "e mail", "email address", "e mail address", "primary email"],
  // Kept apart from the generic column so the number keeps the classification
  // the header gave it. Routing a header that says "mobile" through the
  // general phone field filed it as a landline and exported it as `TYPE=home`.
  mobile: ["mobile", "mobile phone", "cell", "cell phone"],
  phone: ["phone", "phone number", "primary phone", "home phone"],
  workPhone: ["work phone", "business phone", "office phone"],
  employer: ["employer", "organization", "organisation", "company"],
  occupation: ["occupation", "title", "job title", "role"],
  city: ["city", "home city"],
  region: ["region", "state", "province", "home state"],
  country: ["country", "home country"],
  birthDate: ["birth date", "birthday", "birth_date", "bday", "date of birth"],
  birthDatePrecision: ["birth date precision", "birth_date_precision"],
  summary: ["summary", "notes", "note"],
};

/** The date components each precision claims to know. */
const COMPONENTS: Record<DatePrecision, ReadonlyArray<"year" | "month" | "day">> = {
  DAY: ["year", "month", "day"],
  MONTH_DAY: ["month", "day"],
  MONTH: ["year", "month"],
  YEAR: ["year"],
};

function isPrecision(value: string | null): value is DatePrecision {
  return value === "DAY" || value === "MONTH_DAY" || value === "MONTH" || value === "YEAR";
}

/** Whether text read at `parsed` accuracy really carries what `stated` claims. */
function supports(parsed: DatePrecision, stated: DatePrecision): boolean {
  const supplied = new Set(COMPONENTS[parsed]);
  return COMPONENTS[stated].every((part) => supplied.has(part));
}

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Undo the apostrophe the export adds in front of a cell a spreadsheet would
 * otherwise run as a formula, so a file that went out through this app comes
 * back the way it left.
 */
function unneutralise(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * The numbered, paired columns Google and Outlook write.
 *
 * A Google export does not have one email column; it has `E-mail 1 - Value`,
 * `E-mail 2 - Value` and a `- Type` beside each, and the same shape for phones.
 * Matching one index per field kept the first address, threw the rest away,
 * and ignored the column that says whether the number is a mobile — so a
 * two-address contact silently lost one and every number became a landline.
 */
export interface GroupedColumn {
  kind: "email" | "phone";
  index: number;
  value: number;
  type: number | null;
}

const GROUPED = /^(e mail|email|phone) (\d+) (value|address|type)$/;

export function mapGroupedColumns(header: readonly string[]): GroupedColumn[] {
  const found = new Map<string, { kind: "email" | "phone"; index: number; value?: number; type?: number }>();

  header.forEach((raw, column) => {
    const match = GROUPED.exec(normaliseHeader(raw));
    if (!match) return;
    const kind = match[1] === "phone" ? "phone" : "email";
    const index = Number(match[2]);
    const key = `${kind}:${index}`;
    const entry = found.get(key) ?? { kind, index };
    if (match[3] === "type") entry.type ??= column;
    else entry.value ??= column;
    found.set(key, entry);
  });

  const columns: GroupedColumn[] = [];
  for (const entry of found.values()) {
    // A `- Type` with no `- Value` beside it names nothing.
    if (entry.value === undefined) continue;
    columns.push({ kind: entry.kind, index: entry.index, value: entry.value, type: entry.type ?? null });
  }
  return columns.sort((a, b) => a.index - b.index);
}

/**
 * The taxonomy slug a phone's own type column names.
 *
 * Google writes "Mobile", "Home", "Work", "Main" and — from an iPhone —
 * "iPhone". Anything unrecognised falls back to the home term rather than
 * being dropped: an unclassified number is still a number.
 */
function phoneSlug(type: string | null): string {
  const value = type?.toLowerCase() ?? "";
  if (value.includes("mobile") || value.includes("cell") || value.includes("iphone")) return "mobile";
  if (value.includes("work") || value.includes("business") || value.includes("office")) {
    return "work-phone";
  }
  return "home-phone";
}

/** Map header names onto the fields they carry. Unknown columns are dropped. */
export function mapHeader(header: readonly string[]): Map<string, number> {
  const mapping = new Map<string, number>();
  header.forEach((raw, index) => {
    const name = normaliseHeader(raw);
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if (!mapping.has(field) && aliases.includes(name)) mapping.set(field, index);
    }
  });
  return mapping;
}

export function parseCsvContacts(text: string, limit?: number): ParseResult {
  // The header occupies a row of its own, so the cap on contacts is one row
  // short of the cap on rows.
  const rows = parseCsvRows(text, limit === undefined ? undefined : limit + 1);
  if (rows.length === 0) return { rows: [], fileProblem: "That file is empty." };

  const mapping = mapHeader(rows[0]!);
  const grouped = mapGroupedColumns(rows[0]!);
  if (!mapping.has("firstName") && !mapping.has("lastName")) {
    return {
      rows: [],
      fileProblem:
        "No name column found. The first row should be a header — a column called first name or last name is the minimum.",
    };
  }

  const parsed: ParsedRow[] = [];
  rows.slice(1).forEach((fields, offset) => {
    const index = offset + 1;
    const at = (field: string) => {
      const column = mapping.get(field);
      if (column === undefined) return null;
      const value = unneutralise(fields[column] ?? "").trim();
      return value === "" ? null : value;
    };

    const contact: ImportedContact = { ...emptyContact() };
    contact.firstName = at("firstName") ?? "";
    contact.lastName = at("lastName");
    contact.nickname = at("nickname");
    contact.employer = at("employer");
    contact.occupation = at("occupation");
    contact.summary = at("summary");

    if (!contact.firstName && contact.lastName) {
      // A file with only surnames is unusual but real, and filing them under a
      // blank first name would make them unfindable.
      contact.firstName = contact.lastName;
      contact.lastName = null;
    }

    const birth = at("birthDate");
    if (birth) {
      // Accepts the same forms the vCard reader does, which covers our own
      // export's YYYY-MM-DD as well as a year-less birthday.
      const date = parseVCardDate(birth);
      if (date) {
        contact.birthDate = date.date;
        // An explicit precision column, when the file has one, is what the
        // account said rather than what the shape of the text implies — but
        // only where the text actually carries what the precision claims to
        // know. `1990` beside a precision of MONTH_DAY would otherwise declare
        // the placeholder first of January a known day, which is the invented
        // certainty DatePrecision exists to prevent. A precision that claims
        // less than the text supplies is a legitimate downgrade and is kept.
        const stated = at("birthDatePrecision");
        contact.birthDatePrecision =
          isPrecision(stated) && supports(date.precision, stated) ? stated : date.precision;
      }
    }

    // Deduplicated by value, because a header may be matched both by the
    // single-column aliases and as group 1 of a numbered set — `E-mail 1 -
    // Value` is exactly that — and importing the same address twice is worse
    // than either reading of it.
    const seen = new Set<string>();
    const addMethod = (slug: string, value: string | null, label: string | null) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      contact.methods.push({ slug, value, label });
    };

    addMethod("email", at("email"), null);
    addMethod("mobile", at("mobile"), null);
    addMethod("home-phone", at("phone"), null);
    addMethod("work-phone", at("workPhone"), null);

    for (const column of grouped) {
      const value = unneutralise(fields[column.value] ?? "").trim() || null;
      const type = column.type === null ? null : unneutralise(fields[column.type] ?? "").trim() || null;
      addMethod(column.kind === "email" ? "email" : phoneSlug(type), value, type);
    }

    const city = at("city");
    const region = at("region");
    const country = at("country");
    if (city || region || country) {
      contact.addresses.push({
        label: null,
        line1: null,
        line2: null,
        city,
        region,
        postalCode: null,
        country,
      });
    }

    parsed.push({
      index,
      contact: contact.firstName ? contact : null,
      problem: contact.firstName ? null : "No name in this row, so there is nothing to file it under.",
    });
  });

  if (parsed.length === 0) return { rows: [], fileProblem: "That file has a header and no rows." };
  return { rows: parsed, fileProblem: null };
}
