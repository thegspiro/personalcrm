import { describe, expect, it } from "vitest";
import { mapHeader, parseCsvContacts, parseCsvRows } from "@/lib/import/csv";
import { findDuplicate, findInternalDuplicates } from "@/lib/import/dedupe";
import { emptyContact } from "@/lib/import/types";

describe("parseCsvRows", () => {
  it("splits plain rows", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsvRows('a,b\n"Kim, Dave",2')).toEqual([["a", "b"], ["Kim, Dave", "2"]]);
  });

  it("keeps a line break inside a quoted field", () => {
    // Splitting on newlines first would turn this into two malformed rows.
    expect(parseCsvRows('a\n"one\ntwo"')).toEqual([["a"], ["one\ntwo"]]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsvRows('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("treats CRLF as one break, not an empty row", () => {
    expect(parseCsvRows("a\r\n1\r\n2")).toEqual([["a"], ["1"], ["2"]]);
  });

  it("strips the byte-order mark Excel writes", () => {
    // Left in place it becomes part of the first header and nothing matches.
    expect(parseCsvRows("﻿first name\nDave")[0]).toEqual(["first name"]);
  });

  it("drops entirely blank rows", () => {
    expect(parseCsvRows("a\n\n1")).toEqual([["a"], ["1"]]);
  });
});

describe("mapHeader", () => {
  it("matches our own export's header", () => {
    const mapping = mapHeader(["first_name", "last_name", "email"]);
    expect(mapping.get("firstName")).toBe(0);
    expect(mapping.get("email")).toBe(2);
  });

  it("matches what other address books write", () => {
    const mapping = mapHeader(["Given Name", "Family Name", "E-mail 1 - Value"]);
    expect(mapping.get("firstName")).toBe(0);
    expect(mapping.get("lastName")).toBe(1);
  });

  it("ignores a column it does not recognise", () => {
    expect(mapHeader(["first name", "favourite colour"]).has("summary")).toBe(false);
  });
});

describe("parseCsvContacts", () => {
  it("reads a row into a contact", () => {
    const { rows } = parseCsvContacts("first_name,last_name,email\nDave,Kim,dave@example.com");
    expect(rows[0].contact).toMatchObject({ firstName: "Dave", lastName: "Kim" });
    expect(rows[0].contact!.methods[0]).toMatchObject({ slug: "email", value: "dave@example.com" });
  });

  it("keeps a birthday's stated accuracy over the shape of the text", () => {
    const { rows } = parseCsvContacts(
      "first_name,birth_date,birth_date_precision\nDave,1990-04-15,MONTH_DAY",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("MONTH_DAY");
  });

  it("infers accuracy when the file does not state it", () => {
    const { rows } = parseCsvContacts("first_name,birthday\nDave,--0415");
    expect(rows[0].contact!.birthDatePrecision).toBe("MONTH_DAY");
  });

  it("undoes the apostrophe our own export adds to a formula-looking cell", () => {
    // So a file that left through this app comes back the way it went out.
    const { rows } = parseCsvContacts("first_name,summary\nDave,'=1+1");
    expect(rows[0].contact!.summary).toBe("=1+1");
  });

  it("refuses a file with no name column rather than importing blanks", () => {
    const result = parseCsvContacts("colour,size\nred,large");
    expect(result.fileProblem).toContain("No name column");
  });

  it("reports a row with no name instead of creating an empty person", () => {
    const { rows } = parseCsvContacts("first_name,email\n,x@example.com");
    expect(rows[0].contact).toBeNull();
    expect(rows[0].problem).toContain("No name");
  });

  it("files a surname-only row under something findable", () => {
    const { rows } = parseCsvContacts("first_name,last_name\n,Kim");
    expect(rows[0].contact).toMatchObject({ firstName: "Kim", lastName: null });
  });
});

function candidate(overrides: Partial<ReturnType<typeof emptyContact>> = {}) {
  return { ...emptyContact(), firstName: "Dave", lastName: "Kim", ...overrides };
}

describe("findDuplicate", () => {
  const existing = [
    { id: "c1", firstName: "Dave", lastName: "Kim", emails: ["Dave@Example.com"] },
    { id: "c2", firstName: "Ada", lastName: "Lovelace", emails: [] },
  ];

  it("matches on a shared email whatever the casing", () => {
    const match = findDuplicate(
      candidate({
        firstName: "David",
        lastName: "Kimberley",
        methods: [{ slug: "email", value: "dave@example.com", label: null }],
      }),
      existing,
    );
    expect(match).toMatchObject({ id: "c1", reason: "email" });
  });

  it("matches on a full name, but reports it as the weaker reason", () => {
    // Families share names, which is exactly why this is proposed and not done.
    expect(findDuplicate(candidate(), existing)).toMatchObject({ id: "c1", reason: "name" });
  });

  it("will not call two people the same on a first name alone", () => {
    expect(findDuplicate(candidate({ lastName: null }), existing)).toBeNull();
  });

  it("returns nothing when nobody matches", () => {
    expect(findDuplicate(candidate({ firstName: "Zoë", lastName: "Nowak" }), existing)).toBeNull();
  });
});

describe("findInternalDuplicates", () => {
  it("catches the same person appearing twice in one file", () => {
    // Two exports concatenated: neither matches anything on file, and
    // importing both creates exactly the duplicate this exists to prevent.
    const duplicates = findInternalDuplicates([
      candidate({ methods: [{ slug: "email", value: "d@example.com", label: null }] }),
      candidate({ methods: [{ slug: "email", value: "D@Example.com", label: null }] }),
    ]);
    expect(duplicates.has(1)).toBe(true);
    expect(duplicates.has(0)).toBe(false);
  });

  it("catches a repeat by name when there are no emails", () => {
    expect(findInternalDuplicates([candidate(), candidate()]).has(1)).toBe(true);
  });

  it("leaves distinct people alone", () => {
    const duplicates = findInternalDuplicates([
      candidate(),
      candidate({ firstName: "Ada", lastName: "Lovelace" }),
    ]);
    expect(duplicates.size).toBe(0);
  });
});
