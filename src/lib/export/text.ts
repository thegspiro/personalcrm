/**
 * Shared line handling for the two line-based interchange formats.
 *
 * vCard (RFC 6350) and iCalendar (RFC 5545) agree on the awkward parts: lines
 * are delimited by CRLF, must not exceed 75 **octets**, and are continued by
 * breaking with CRLF and beginning the next line with a single space. Both
 * escape the same handful of characters inside a value.
 *
 * The octet part is the trap. A naïve fold counts JavaScript string units, so a
 * line of accented names or emoji folds late and — worse — can split a
 * multi-byte character down the middle, which produces a file that a parser
 * either rejects or silently mangles. Folding here is done on encoded bytes,
 * and never inside a character.
 */

/** Both formats delimit with CRLF, not LF, and parsers do notice. */
export const CRLF = "\r\n";

/** The octet limit both specifications give, excluding the line break. */
const MAX_OCTETS = 75;

const encoder = new TextEncoder();

/** How many octets this string occupies once encoded. */
export function octetLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Fold one content line to the octet limit.
 *
 * Continuation lines carry a leading space, which the parser strips. The first
 * line gets the full limit; each continuation loses one octet to that space.
 * Characters are never split: the fold walks by code point and stops before
 * the next one would cross the boundary.
 */
export function foldLine(line: string): string {
  if (octetLength(line) <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  // The first line may use the whole limit; continuations spend one octet on
  // the leading space that marks them as continuations.
  let limit = MAX_OCTETS;

  // Iterating the string yields whole code points, so a surrogate pair is
  // never torn apart.
  for (const character of line) {
    const size = octetLength(character);
    if (currentOctets + size > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += character;
    currentOctets += size;
  }
  if (current) parts.push(current);

  return parts.join(`${CRLF} `);
}

/**
 * Escape a value for a vCard or iCalendar property.
 *
 * Backslash first, or escaping the others would then escape their own
 * backslashes. Newlines become the literal two-character sequence `\n`, which
 * is what both specifications use to carry a line break *inside* a value —
 * distinct from the CRLF that ends the line.
 */
export function escapeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Assemble folded, CRLF-delimited content lines into a file. */
export function joinLines(lines: readonly string[]): string {
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
