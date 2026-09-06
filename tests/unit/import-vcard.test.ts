import { describe, expect, it } from "vitest";
import {
  parseProperty,
  parseVCard,
  parseVCardDate,
  splitStructured,
  unescapeValue,
  unfold,
} from "@/lib/import/vcard";

const CARD = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Dave Kim",
  "N:Kim;Dave;;;",
  "EMAIL;TYPE=home:dave@example.com",
  "TEL;TYPE=cell:+15550104477",
  "BDAY:--0415",
  "END:VCARD",
].join("\r\n");

describe("unfold", () => {
  it("joins a continuation back onto its line", () => {
    expect(unfold("NOTE:one\r\n two")).toEqual(["NOTE:onetwo"]);
  });

  it("accepts bare LF, which real files use at least as often", () => {
    expect(unfold("NOTE:one\n two")).toEqual(["NOTE:onetwo"]);
  });

  it("treats a tab as a continuation too", () => {
    expect(unfold("NOTE:one\r\n\ttwo")).toEqual(["NOTE:onetwo"]);
  });

  it("drops blank lines rather than treating them as properties", () => {
    expect(unfold("A:1\r\n\r\nB:2")).toEqual(["A:1", "B:2"]);
  });
});

describe("unescapeValue", () => {
  it("undoes the four escapes the format defines", () => {
    expect(unescapeValue(String.raw`a\,b`)).toBe("a,b");
    expect(unescapeValue(String.raw`a\;b`)).toBe("a;b");
    expect(unescapeValue(String.raw`a\\b`)).toBe("a\\b");
    expect(unescapeValue(String.raw`a\nb`)).toBe("a\nb");
  });

  it("accepts the capital N some exporters write", () => {
    expect(unescapeValue(String.raw`a\Nb`)).toBe("a\nb");
  });

  it("survives a trailing backslash rather than reading past the end", () => {
    expect(unescapeValue("a\\")).toBe("a");
  });
});

describe("splitStructured", () => {
  it("splits on the separator", () => {
    expect(splitStructured("a;b;c")).toEqual(["a", "b", "c"]);
  });

  it("does not split on an escaped separator", () => {
    // The bug this guards: splitting after unescaping turns a semicolon
    // inside a surname into a field boundary.
    expect(splitStructured(String.raw`Kim\; Jr;Dave`)).toEqual([String.raw`Kim\; Jr`, "Dave"]);
  });

  it("keeps empty fields, which carry position in a structured value", () => {
    expect(splitStructured(";;street;city")).toEqual(["", "", "street", "city"]);
  });
});

describe("parseProperty", () => {
  it("splits name, parameters and value", () => {
    const property = parseProperty("EMAIL;TYPE=work:dave@example.com")!;
    expect(property.name).toBe("EMAIL");
    expect(property.params.get("TYPE")).toBe("work");
    expect(property.value).toBe("dave@example.com");
  });

  it("does not end the value at a colon inside it", () => {
    // A URL would otherwise be truncated to "https".
    expect(parseProperty("URL:https://example.com/x")!.value).toBe("https://example.com/x");
  });

  it("ignores a colon inside a quoted parameter", () => {
    const property = parseProperty('TEL;TYPE="work:main":+15550104477')!;
    expect(property.value).toBe("+15550104477");
  });

  it("reads the bare type vCard 2.1 exporters still write", () => {
    expect(parseProperty("TEL;CELL:+15550104477")!.params.get("TYPE")).toBe("cell");
  });

  it("strips a property group prefix", () => {
    expect(parseProperty("item1.TEL:+15550104477")!.name).toBe("TEL");
  });

  it("returns nothing for a line with no colon at all", () => {
    expect(parseProperty("GARBAGE")).toBeNull();
  });
});

describe("parseVCardDate", () => {
  it("reads a full date with or without hyphens", () => {
    expect(parseVCardDate("19900415")).toEqual({
      date: { year: 1990, month: 4, day: 15 },
      precision: "DAY",
    });
    expect(parseVCardDate("1990-04-15")!.precision).toBe("DAY");
  });

  it("keeps a birthday whose year the source did not state", () => {
    // The whole reason this parser exists rather than a borrowed one.
    const parsed = parseVCardDate("--0415")!;
    expect(parsed.precision).toBe("MONTH_DAY");
    expect(parsed.date.month).toBe(4);
    expect(parsed.date.day).toBe(15);
  });

  it("accepts the hyphenated year-less form too", () => {
    expect(parseVCardDate("--04-15")!.precision).toBe("MONTH_DAY");
  });

  it("reads reduced accuracy without inventing the missing part", () => {
    expect(parseVCardDate("1990-04")!.precision).toBe("MONTH");
    expect(parseVCardDate("1990")!.precision).toBe("YEAR");
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(parseVCardDate("not a date")).toBeNull();
    expect(parseVCardDate("19901345")).toBeNull();
    expect(parseVCardDate("")).toBeNull();
  });
});

describe("parseVCard", () => {
  it("reads a card into a contact", () => {
    const { rows, fileProblem } = parseVCard(CARD);
    expect(fileProblem).toBeNull();
    expect(rows).toHaveLength(1);

    const contact = rows[0].contact!;
    expect(contact.firstName).toBe("Dave");
    expect(contact.lastName).toBe("Kim");
    expect(contact.birthDatePrecision).toBe("MONTH_DAY");
    expect(contact.methods).toEqual([
      { slug: "email", value: "dave@example.com", label: "home" },
      { slug: "mobile", value: "+15550104477", label: "cell" },
    ]);
  });

  it("reads several cards from one file", () => {
    const { rows } = parseVCard(`${CARD}\r\n${CARD.replace("Dave Kim", "Ada Lovelace").replace("N:Kim;Dave;;;", "N:Lovelace;Ada;;;")}`);
    expect(rows).toHaveLength(2);
    expect(rows[1].contact!.firstName).toBe("Ada");
  });

  it("falls back to the formatted name when there is no structured one", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Ada Lovelace\r\nEND:VCARD");
    expect(rows[0].contact).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("files a single-word name as a first name rather than a blank", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Prince\r\nEND:VCARD");
    expect(rows[0].contact).toMatchObject({ firstName: "Prince", lastName: null });
  });

  it("reports a nameless card instead of importing an empty person", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nEMAIL:x@example.com\r\nEND:VCARD");
    expect(rows[0].contact).toBeNull();
    expect(rows[0].problem).toContain("No name");
  });

  it("keeps a semicolon inside a surname", () => {
    const { rows } = parseVCard(
      String.raw`BEGIN:VCARD` + "\r\n" + String.raw`N:Kim\, Jr;Dave;;;` + "\r\nEND:VCARD",
    );
    expect(rows[0].contact!.lastName).toBe("Kim, Jr");
  });

  it("reads an address into its parts", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN:Dave\r\nADR;TYPE=home:;;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD",
    );
    expect(rows[0].contact!.addresses[0]).toMatchObject({
      line1: "123 Main St",
      city: "Springfield",
      region: "IL",
      postalCode: "62704",
      country: "USA",
    });
  });

  it("ignores an address that is only separators", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Dave\r\nADR:;;;;;;\r\nEND:VCARD");
    expect(rows[0].contact!.addresses).toHaveLength(0);
  });

  it("says so when the file is not vCard at all", () => {
    expect(parseVCard("first_name,last_name\nDave,Kim").fileProblem).toContain("No vCards");
  });

  it("survives an unterminated card rather than throwing", () => {
    expect(() => parseVCard("BEGIN:VCARD\r\nFN:Dave")).not.toThrow();
  });
});
