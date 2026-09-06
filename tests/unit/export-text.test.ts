import { describe, expect, it } from "vitest";
import { CRLF, escapeValue, foldLine, joinLines, octetLength } from "@/lib/export/text";

describe("escapeValue", () => {
  it("escapes the four characters both formats reserve", () => {
    expect(escapeValue("a,b")).toBe("a\\,b");
    expect(escapeValue("a;b")).toBe("a\\;b");
    expect(escapeValue("a\\b")).toBe("a\\\\b");
    expect(escapeValue("a\nb")).toBe("a\\nb");
  });

  it("escapes the backslash first, so escapes are not escaped again", () => {
    // Doing this in the other order turns one backslash into three.
    expect(escapeValue("\\,")).toBe("\\\\\\,");
  });

  it("drops carriage returns rather than emitting a bare one", () => {
    // A literal CR inside a value would be read as the end of the line.
    expect(escapeValue("a\r\nb")).toBe("a\\nb");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeValue("Dave Kim")).toBe("Dave Kim");
  });
});

describe("foldLine", () => {
  it("leaves a line within the limit untouched", () => {
    const short = "NOTE:hello";
    expect(foldLine(short)).toBe(short);
  });

  it("folds with CRLF and a leading space", () => {
    const folded = foldLine(`NOTE:${"a".repeat(100)}`);
    expect(folded).toContain(`${CRLF} `);
    // Unfolding is removing CRLF-space, and must give back the original.
    expect(folded.split(`${CRLF} `).join("")).toBe(`NOTE:${"a".repeat(100)}`);
  });

  it("counts octets, not string length", () => {
    // Eighty é characters are 160 octets but only 80 string units, so a fold
    // that counts the wrong thing would not fold this at all.
    const line = `NOTE:${"é".repeat(80)}`;
    expect(line.length).toBeLessThan(90);
    expect(octetLength(line)).toBeGreaterThan(75);
    expect(foldLine(line)).toContain(CRLF);
  });

  it("never splits a character across the fold", () => {
    // The failure this guards: a fold by string index can leave half a
    // multi-octet character at the end of one line and half at the start of
    // the next, which is not valid UTF-8 in either.
    for (const filler of ["é", "→", "😀"]) {
      const folded = foldLine(`NOTE:${filler.repeat(60)}`);
      for (const segment of folded.split(`${CRLF} `)) {
        expect(octetLength(segment)).toBeLessThanOrEqual(75);
        expect(segment).not.toContain("�");
      }
      expect(folded.split(`${CRLF} `).join("")).toBe(`NOTE:${filler.repeat(60)}`);
    }
  });

  it("keeps every continuation within the limit once its space is counted", () => {
    const folded = foldLine(`NOTE:${"a".repeat(500)}`);
    const [first, ...rest] = folded.split(`${CRLF} `);
    expect(octetLength(first)).toBeLessThanOrEqual(75);
    // A continuation plus its leading space must still fit.
    for (const segment of rest) expect(octetLength(segment) + 1).toBeLessThanOrEqual(75);
  });
});

describe("joinLines", () => {
  it("delimits with CRLF and ends the file with one", () => {
    expect(joinLines(["BEGIN:VCARD", "END:VCARD"])).toBe(
      `BEGIN:VCARD${CRLF}END:VCARD${CRLF}`,
    );
  });
});
