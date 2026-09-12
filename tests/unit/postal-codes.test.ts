import { describe, expect, it } from "vitest";
import {
  foldPostalCode,
  parsePostalCodeFile,
  POSTAL_CODE_LIMIT,
} from "@/lib/postal-codes";

/**
 * Reading a GeoNames postal code file.
 *
 * The fixtures are real lines in the published shape — twelve tab-separated
 * columns, of which four are read. Recorded rather than invented, because the
 * columns this ignores are exactly where a miscount would hide.
 */

/** `US.txt`, verbatim in shape: code, place, state, then the parts not kept. */
const US = [
  "US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4",
  "US\t10001\tNew York\tNew York\tNY\tNew York\t061\t\t\t40.7484\t-73.9967\t4",
].join("\n");

function parse(text: string) {
  const result = parsePostalCodeFile(text);
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`);
  return result;
}

describe("folding a postal code", () => {
  it("brings the ways one code is written together", () => {
    // A person types one, the file holds another. Both have to meet.
    expect(foldPostalCode("sw1a 1aa")).toBe("SW1A1AA");
    expect(foldPostalCode("SW1A1AA")).toBe("SW1A1AA");
    expect(foldPostalCode("1012 AB")).toBe("1012AB");
    expect(foldPostalCode(" 90210 ")).toBe("90210");
    expect(foldPostalCode("K1A-0B1")).toBe("K1A0B1");
  });

  it("keeps the digits and letters and nothing else", () => {
    expect(foldPostalCode("...")).toBe("");
  });
});

describe("reading a country file", () => {
  it("keeps the four columns that answer the question", () => {
    const { country, rows, skipped } = parse(US);
    expect(country).toBe("US");
    expect(skipped).toBe(0);
    expect(rows[0]).toEqual({
      country: "US",
      code: "90210",
      lookup: "90210",
      place: "Beverly Hills",
      region: "California",
    });
  });

  it("keeps the code as written and folds it separately", () => {
    // The written form is what gets shown back; the folded one is what a
    // person's typing is matched against.
    const [row] = parse("GB\tSW1A 1AA\tLondon\tEngland\tENG").rows;
    expect(row.code).toBe("SW1A 1AA");
    expect(row.lookup).toBe("SW1A1AA");
  });

  it("keeps a code that names several places, as several rows", () => {
    // Not duplication — a postal code really can cover more than one place, and
    // that ambiguity is what stops the address form guessing between them.
    const { rows } = parse(
      ["US\t12345\tSchenectady\tNew York\tNY", "US\t12345\tGeneral Electric\tNew York\tNY"].join("\n"),
    );
    expect(rows).toHaveLength(2);
  });

  it("does not let a file's own repeated line fail the insert", () => {
    const { rows } = parse([US.split("\n")[0], US.split("\n")[0]].join("\n"));
    expect(rows).toHaveLength(1);
  });

  it("treats a missing region as absent rather than empty", () => {
    const [row] = parse("US\t90210\tBeverly Hills\t\t").rows;
    expect(row.region).toBeNull();
  });

  it("reads a line that stops after the place", () => {
    // Fewer columns than the format allows for is still enough to answer the
    // question, so it is read rather than discarded.
    const [row] = parse("US\t90210\tBeverly Hills").rows;
    expect(row.place).toBe("Beverly Hills");
    expect(row.region).toBeNull();
  });

  it("counts what it could not read instead of failing the file", () => {
    const { rows, skipped } = parse(
      [
        US.split("\n")[0],
        "", // blank
        "   ", // whitespace
        "US\t90210", // no place
        "not tab separated at all",
        "USA\t90210\tSomewhere", // not an ISO country code
        `US\t${"9".repeat(21)}\tToo long a code`,
        `US\t99999\t${"x".repeat(181)}`,
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    // Blank lines are not "unreadable", so they are not counted.
    expect(skipped).toBe(5);
  });

  it("refuses a file holding more than one country", () => {
    // `allCountries.txt` is the file somebody reaches for by mistake, so the
    // refusal names what it found rather than only that it was wrong.
    const result = parsePostalCodeFile(
      ["US\t90210\tBeverly Hills\tCalifornia", "CA\tK1A 0B1\tOttawa\tOntario"].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("mixed");
    expect(result.detail).toBe("CA, US");
  });

  it("refuses a file with nothing readable in it", () => {
    expect(parsePostalCodeFile("").ok).toBe(false);
    expect(parsePostalCodeFile("\n\n   \n").ok).toBe(false);
    const result = parsePostalCodeFile("this is not a postal code file");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("refuses a file past the ceiling rather than filling the database", () => {
    const line = (n: number) => `US\t${String(n).padStart(5, "0")}\tPlace ${n}\tState`;
    const many = Array.from({ length: POSTAL_CODE_LIMIT + 2 }, (_, i) => line(i)).join("\n");
    const result = parsePostalCodeFile(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-many");
  });

  it("reads a file that ends with a newline, as the published ones do", () => {
    expect(parse(`${US}\n`).rows).toHaveLength(2);
  });

  it("reads a file with Windows line endings", () => {
    expect(parse(US.replace(/\n/g, "\r\n")).rows).toHaveLength(2);
  });
});
