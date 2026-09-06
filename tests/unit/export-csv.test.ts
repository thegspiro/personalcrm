import { describe, expect, it } from "vitest";
import { csvDocument, csvField, csvRow } from "@/lib/export/csv";

describe("csvField", () => {
  it("leaves an ordinary value unquoted", () => {
    expect(csvField("Dave Kim")).toBe("Dave Kim");
  });

  it("quotes what would otherwise break the record", () => {
    expect(csvField("Kim, Dave")).toBe('"Kim, Dave"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });

  it("doubles quotes inside a quoted field", () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes surrounding whitespace rather than letting a reader strip it", () => {
    // A name that comes back trimmed is quiet corruption, which is the one
    // thing an export must not do.
    expect(csvField(" Dave ")).toBe('" Dave "');
  });

  it("neutralises a cell a spreadsheet would run as a formula", () => {
    // Excel and Sheets execute a cell beginning with any of these on open.
    for (const leader of ["=", "+", "-", "@"]) {
      expect(csvField(`${leader}HYPERLINK("http://x")`)).toContain(`'${leader}`);
    }
  });

  it("does not disturb a value that merely contains one later", () => {
    expect(csvField("a=b")).toBe("a=b");
  });

  it("renders absent values as empty rather than as the word null", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("keeps false rather than treating it as absent", () => {
    expect(csvField(false)).toBe("false");
    expect(csvField(0)).toBe("0");
  });
});

describe("csvRow", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["a", "b", null])).toBe("a,b,");
  });
});

describe("csvDocument", () => {
  it("leads with a byte-order mark so Excel reads it as UTF-8", () => {
    // Without it Excel reads the local codepage and mangles every accented
    // name in the file.
    expect(csvDocument(["name"], [["Zoë"]]).startsWith("﻿")).toBe(true);
  });

  it("delimits records with CRLF and ends the file with one", () => {
    expect(csvDocument(["a"], [["1"], ["2"]])).toBe("﻿a\r\n1\r\n2\r\n");
  });
});
