import { describe, expect, it } from "vitest";
import {
  decodeQuotedPrintable,
  parseProperty,
  parseVCard,
  parseVCardDate,
  splitStructured,
  stripScheme,
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

  it("refuses a day that month does not have, instead of moving it", () => {
    // Accepting these means the database ends up with a confident 28 February
    // that the file never said, which is the failure mode DatePrecision exists
    // to prevent.
    expect(parseVCardDate("19900231")).toBeNull();
    expect(parseVCardDate("--0431")).toBeNull();
    expect(parseVCardDate("19900931")).toBeNull();
    expect(parseVCardDate("1990-04-00")).toBeNull();
  });

  it("allows 29 February only in a year that has one", () => {
    expect(parseVCardDate("19910229")).toBeNull();
    expect(parseVCardDate("19000229")).toBeNull();
    expect(parseVCardDate("19920229")!.precision).toBe("DAY");
    expect(parseVCardDate("20000229")!.precision).toBe("DAY");
    // Year-less, so the placeholder year says nothing about leap years.
    expect(parseVCardDate("--0229")!.precision).toBe("MONTH_DAY");
  });

  it("refuses a month a year-and-month value does not have", () => {
    expect(parseVCardDate("1990-13")).toBeNull();
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

describe("decodeQuotedPrintable", () => {
  it("reads a multi-byte character from its several escapes at once", () => {
    // Decoding =C3 and =A9 separately would produce mojibake, not "é".
    expect(decodeQuotedPrintable("Jos=C3=A9")).toBe("José");
  });

  it("leaves unescaped text alone", () => {
    expect(decodeQuotedPrintable("Dave Kim")).toBe("Dave Kim");
  });

  it("drops the soft line break an exporter leaves at the end", () => {
    expect(decodeQuotedPrintable("Kim=")).toBe("Kim");
  });

  it("keeps an = that does not introduce a hex pair", () => {
    expect(decodeQuotedPrintable("a=zz")).toBe("a=zz");
  });
});

describe("stripScheme", () => {
  it("removes a tel URI scheme", () => {
    expect(stripScheme("tel:+15550104477")).toBe("+15550104477");
  });

  it("removes a mailto scheme whatever its case", () => {
    expect(stripScheme("MAILTO:dave@example.com")).toBe("dave@example.com");
  });

  it("leaves a bare number untouched", () => {
    expect(stripScheme("+15550104477")).toBe("+15550104477");
  });

  it("does not strip the scheme from a web address", () => {
    expect(stripScheme("https://example.com")).toBe("https://example.com");
  });
});

describe("vCard 2.1 and other exporter quirks", () => {
  it("keeps every bare type token rather than only the last", () => {
    // `TEL;CELL;VOICE` is a mobile; reading only VOICE files it as a landline.
    const property = parseProperty("TEL;CELL;VOICE:+15550104477")!;
    expect(property.params.get("TYPE")).toBe("cell voice");
  });

  it("files a CELL;VOICE number as a mobile", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Dave\r\nTEL;CELL;VOICE:+15550104477\r\nEND:VCARD");
    expect(rows[0].contact!.methods[0]).toMatchObject({ slug: "mobile" });
  });

  it("decodes a quoted-printable name instead of importing the escapes", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa\r\nEND:VCARD",
    );
    expect(rows[0].contact).toMatchObject({ firstName: "José", lastName: "García" });
  });

  it("strips the tel scheme off an imported number", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Dave\r\nTEL;TYPE=cell:tel:+15550104477\r\nEND:VCARD");
    expect(rows[0].contact!.methods[0].value).toBe("+15550104477");
  });

  it("resolves a URL to the website term, which is the one that exists", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Dave\r\nURL:https://example.com\r\nEND:VCARD");
    expect(rows[0].contact!.methods[0]).toMatchObject({
      slug: "website",
      value: "https://example.com",
    });
  });

  it("keeps the post-office box rather than discarding it", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN:Dave\r\nADR:PO Box 12;Suite 4;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD",
    );
    expect(rows[0].contact!.addresses[0]).toMatchObject({
      line1: "123 Main St",
      line2: "PO Box 12, Suite 4",
    });
  });

  it("keeps a box-only address, which would otherwise vanish entirely", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN:Dave\r\nADR:PO Box 12;;;Springfield;IL;62704;USA\r\nEND:VCARD",
    );
    expect(rows[0].contact!.addresses[0]).toMatchObject({ line2: "PO Box 12", city: "Springfield" });
  });

  it("does not file a surname-only card as the name twice over", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Doe\r\nN:Doe;;;;\r\nEND:VCARD");
    expect(rows[0].contact).toMatchObject({ firstName: "Doe", lastName: null });
  });

  it("still keeps a surname that differs from the formatted name", () => {
    const { rows } = parseVCard("BEGIN:VCARD\r\nFN:Prince\r\nN:Nelson;;;;\r\nEND:VCARD");
    expect(rows[0].contact).toMatchObject({ firstName: "Prince", lastName: "Nelson" });
  });
});

describe("quoted-printable soft line breaks", () => {
  it("joins a wrapped value before decoding it", () => {
    // The wrap has no leading whitespace, so the ordinary fold never joins it:
    // left alone the second line parses as nothing and the first decodes to
    // half a character.
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE:Jos=C3=\r\n=A9\r\nEND:VCARD",
    );
    expect(rows[0].contact!.firstName).toBe("José");
  });

  it("joins several wraps in a row", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE:Jos=C3=\r\n=A9 Garc=\r\n=C3=ADa\r\nEND:VCARD",
    );
    expect(rows[0].contact).toMatchObject({ firstName: "José", lastName: "García" });
  });

  it("leaves a plain value that happens to end in = alone", () => {
    const lines = unfold("NOTE:a=\r\nFN:Dave");
    expect(lines).toEqual(["NOTE:a=", "FN:Dave"]);
  });

  it("joins only when the line declares the encoding", () => {
    expect(unfold("FN;ENCODING=QUOTED-PRINTABLE:a=\r\nb")).toEqual([
      "FN;ENCODING=QUOTED-PRINTABLE:ab",
    ]);
  });
});

describe("address labels", () => {
  it("reads the LABEL this export writes, with its case intact", () => {
    const { rows } = parseVCard(
      'BEGIN:VCARD\r\nFN:Dave\r\nADR;LABEL="Parents":;;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD',
    );
    expect(rows[0].contact!.addresses[0]!.label).toBe("Parents");
  });

  it("falls back to TYPE when there is no LABEL", () => {
    const { rows } = parseVCard(
      "BEGIN:VCARD\r\nFN:Dave\r\nADR;TYPE=home:;;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD",
    );
    expect(rows[0].contact!.addresses[0]!.label).toBe("home");
  });

  it("keeps a free-text parameter unchanged while lower-casing TYPE", () => {
    const property = parseProperty('ADR;TYPE=HOME;LABEL="Summer House":;;;;;;')!;
    expect(property.params.get("TYPE")).toBe("home");
    expect(property.params.get("LABEL")).toBe("Summer House");
  });
});
