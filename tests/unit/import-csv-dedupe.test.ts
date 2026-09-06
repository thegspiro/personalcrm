import { describe, expect, it } from "vitest";
import { mapGroupedColumns, mapHeader, parseCsvContacts, parseCsvRows } from "@/lib/import/csv";
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

describe("Google and Outlook headers", () => {
  it("recognises Google's hyphenated email header", () => {
    // `E-mail 1 - Value` normalises to `e mail 1 value`; matching only the
    // unhyphenated spelling imported every Google contact with no email at
    // all, and silently, since the rows themselves arrived fine.
    const { rows } = parseCsvContacts(
      "Given Name,Family Name,E-mail 1 - Value\nDave,Kim,dave@example.com",
    );
    expect(rows[0].contact!.methods).toContainEqual({
      slug: "email",
      value: "dave@example.com",
      label: null,
    });
  });

  it("keeps a mobile column classified as a mobile", () => {
    const { rows } = parseCsvContacts("first name,mobile\nDave,+15550104477");
    expect(rows[0].contact!.methods).toContainEqual({
      slug: "mobile",
      value: "+15550104477",
      label: null,
    });
  });

  it("files a work phone under the work term", () => {
    const { rows } = parseCsvContacts("first name,work phone\nDave,+15550100000");
    expect(rows[0].contact!.methods[0]!.slug).toBe("work-phone");
  });

  it("still files a bare phone column as a home phone", () => {
    const { rows } = parseCsvContacts("first name,phone\nDave,+15550100000");
    expect(rows[0].contact!.methods[0]!.slug).toBe("home-phone");
  });

  it("keeps a mobile and a landline apart in one row", () => {
    const { rows } = parseCsvContacts(
      "first name,mobile,home phone\nDave,+15550104477,+15550100000",
    );
    expect(rows[0].contact!.methods.map((m) => m.slug)).toEqual(["mobile", "home-phone"]);
  });
});

describe("a stated birth-date precision", () => {
  it("is refused when the text does not carry what it claims", () => {
    // `1990` supplies a year and nothing else. Honouring MONTH_DAY here would
    // store the placeholder first of January as a day somebody stated.
    const { rows } = parseCsvContacts(
      "first name,birth date,birth date precision\nDave,1990,MONTH_DAY",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("YEAR");
  });

  it("is refused when it claims a year the text has not got", () => {
    const { rows } = parseCsvContacts(
      "first name,birth date,birth date precision\nDave,--04-15,DAY",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("MONTH_DAY");
  });

  it("is honoured as a downgrade, which is a real thing to say", () => {
    const { rows } = parseCsvContacts(
      "first name,birth date,birth date precision\nDave,1990-04-15,YEAR",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("YEAR");
  });

  it("round-trips what this export writes", () => {
    const { rows } = parseCsvContacts(
      "first name,birth date,birth date precision\nDave,--04-15,MONTH_DAY",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("MONTH_DAY");
  });

  it("ignores a precision column holding something else entirely", () => {
    const { rows } = parseCsvContacts(
      "first name,birth date,birth date precision\nDave,1990-04-15,whenever",
    );
    expect(rows[0].contact!.birthDatePrecision).toBe("DAY");
  });
});

describe("Google's numbered, paired columns", () => {
  const HEADER = [
    "Given Name",
    "Family Name",
    "E-mail 1 - Type",
    "E-mail 1 - Value",
    "E-mail 2 - Value",
    "Phone 1 - Type",
    "Phone 1 - Value",
  ];

  it("finds each group and the type column beside it", () => {
    expect(mapGroupedColumns(HEADER)).toEqual([
      { kind: "email", index: 1, value: 3, type: 2 },
      { kind: "phone", index: 1, value: 6, type: 5 },
      { kind: "email", index: 2, value: 4, type: null },
    ]);
  });

  it("ignores a type column with no value column beside it", () => {
    expect(mapGroupedColumns(["Given Name", "Phone 2 - Type"])).toEqual([]);
  });

  it("keeps a second email instead of discarding it", () => {
    const { rows } = parseCsvContacts(
      `${HEADER.join(",")}\nDave,Kim,Home,dave@example.com,dave@work.example.com,Mobile,+15550104477`,
    );
    const values = rows[0].contact!.methods.map((m) => m.value);
    expect(values).toContain("dave@example.com");
    expect(values).toContain("dave@work.example.com");
  });

  it("reads the phone's classification from its own type column", () => {
    const { rows } = parseCsvContacts(
      `${HEADER.join(",")}\nDave,Kim,Home,dave@example.com,,Mobile,+15550104477`,
    );
    expect(rows[0].contact!.methods.find((m) => m.value === "+15550104477")!.slug).toBe("mobile");
  });

  it("reads an iPhone as a mobile, which is what Google calls it", () => {
    const { rows } = parseCsvContacts(
      "Given Name,Phone 1 - Type,Phone 1 - Value\nDave,iPhone,+15550104477",
    );
    expect(rows[0].contact!.methods[0]!.slug).toBe("mobile");
  });

  it("keeps a number whose type it does not recognise", () => {
    const { rows } = parseCsvContacts(
      "Given Name,Phone 1 - Type,Phone 1 - Value\nDave,Pager,+15550104477",
    );
    expect(rows[0].contact!.methods[0]).toMatchObject({
      slug: "home-phone",
      value: "+15550104477",
    });
  });

  it("does not import the same address twice when both readings match it", () => {
    // `E-mail 1 - Value` is matched by the single-column alias and as group 1.
    const { rows } = parseCsvContacts(
      "Given Name,E-mail 1 - Value\nDave,dave@example.com",
    );
    expect(rows[0].contact!.methods).toHaveLength(1);
  });

  it("reads Outlook's numbered address columns too", () => {
    const { rows } = parseCsvContacts(
      "First Name,E-mail 2 Address\nDave,dave@work.example.com",
    );
    expect(rows[0].contact!.methods[0]).toMatchObject({
      slug: "email",
      value: "dave@work.example.com",
    });
  });
});

describe("the row cap during parsing", () => {
  it("stops scanning instead of materialising the whole file", () => {
    // A file under the character limit can still hold millions of short rows.
    // Building them all and then refusing the request spends exactly the
    // memory the cap exists to protect.
    const many = `first name\n${"a\n".repeat(5_000)}`;
    // One past the cap, so the caller can still tell "too many" from
    // "exactly the maximum" without having read the rest of the file.
    expect(parseCsvRows(many, 11)).toHaveLength(12);
  });

  it("keeps one row past the cap, so too many is distinguishable from exactly enough", () => {
    const { rows } = parseCsvContacts(`first name\n${"a\n".repeat(50)}`, 10);
    expect(rows).toHaveLength(11);
  });

  it("returns everything when the file is inside the cap", () => {
    const { rows } = parseCsvContacts("first name\nAda\nBea", 10);
    expect(rows).toHaveLength(2);
  });

  it("is unbounded when no cap is given", () => {
    expect(parseCsvRows(`a\n${"b\n".repeat(30)}`)).toHaveLength(31);
  });
});
