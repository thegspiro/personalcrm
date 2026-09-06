/**
 * Reading CSV, per RFC 4180 — the other way people's contacts already exist.
 *
 * Two jobs that are worth keeping apart: turning the text into rows of fields,
 * which is fiddly and entirely mechanical, and deciding what those fields
 * mean, which depends on whose exporter wrote the header.
 */
import { emptyContact, type ImportedContact, type ParseResult, type ParsedRow } from "./types";
import { parseVCardDate } from "./vcard";

/**
 * Split the text into rows of fields.
 *
 * A quoted field may contain commas, quotes (doubled) and line breaks, which
 * is why this cannot be `split("\n")` followed by `split(",")` — a note
 * containing a newline would silently become two malformed rows.
 */
export function parseCsvRows(text: string): string[][] {
  // Excel and our own export both write a byte-order mark; left in place it
  // becomes part of the first header name and no column matches.
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

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
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Whatever is still in hand when the text runs out is a final row, unless
  // the file simply ended with a line break.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
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
  email: ["email", "e mail", "email address", "e mail address", "email 1 value", "primary email"],
  phone: ["phone", "phone number", "mobile", "mobile phone", "phone 1 value", "primary phone"],
  employer: ["employer", "organization", "organisation", "company"],
  occupation: ["occupation", "title", "job title", "role"],
  city: ["city", "home city"],
  region: ["region", "state", "province", "home state"],
  country: ["country", "home country"],
  birthDate: ["birth date", "birthday", "birth_date", "bday", "date of birth"],
  birthDatePrecision: ["birth date precision", "birth_date_precision"],
  summary: ["summary", "notes", "note"],
};

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

export function parseCsvContacts(text: string): ParseResult {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { rows: [], fileProblem: "That file is empty." };

  const mapping = mapHeader(rows[0]!);
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
        // account said rather than what the shape of the text implies.
        const stated = at("birthDatePrecision");
        contact.birthDatePrecision =
          stated === "MONTH_DAY" || stated === "MONTH" || stated === "YEAR" || stated === "DAY"
            ? stated
            : date.precision;
      }
    }

    const email = at("email");
    if (email) contact.methods.push({ slug: "email", value: email, label: null });
    const phone = at("phone");
    if (phone) contact.methods.push({ slug: "home-phone", value: phone, label: null });

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
