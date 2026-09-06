/**
 * Comma-separated values, per RFC 4180.
 *
 * The lossy format, deliberately: one row per person, the fields a spreadsheet
 * can actually hold, and nothing nested. Anything that matters for getting the
 * account back belongs in the JSON export, which keeps everything.
 */

/** RFC 4180 delimits records with CRLF, and Excel is fussy about it. */
const CRLF = "\r\n";

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than
 * text. A cell beginning with one of these is executed by Excel and Sheets on
 * open — a well-known way to turn a data export into code execution on the
 * machine of whoever opens it.
 */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutralise a leading formula character.
 *
 * Prefixing with an apostrophe is what spreadsheets understand as "this is
 * text"; it is visible in the cell's contents but not in its display. It does
 * modify the value, which is precisely why this is done here and not in the
 * JSON export: CSV is the format for looking at, JSON is the format for
 * getting your account back.
 */
function neutralise(value: string): string {
  return value.length > 0 && FORMULA_LEADERS.has(value[0]!) ? `'${value}` : value;
}

/**
 * Quote a field when it needs it, and double any quotes inside.
 *
 * Leading or trailing whitespace is quoted too — unquoted, a reader is
 * entitled to strip it, and a name that came back different from the one that
 * went in is exactly the kind of quiet corruption an export exists to avoid.
 */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = neutralise(String(value));
  const needsQuoting = /[",\r\n]/.test(raw) || raw !== raw.trim();
  return needsQuoting ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** One record. */
export function csvRow(fields: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return fields.map(csvField).join(",");
}

/**
 * A whole document, header first.
 *
 * The byte-order mark is there for Excel, which otherwise reads a UTF-8 file
 * as the local codepage and mangles every accented name in it. Every other
 * reader tolerates the mark.
 */
export function csvDocument(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `﻿${lines.join(CRLF)}${CRLF}`;
}
