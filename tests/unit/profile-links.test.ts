import { describe, expect, it } from "vitest";
import { profileLinksSchema, readProfileLinks } from "@/lib/profile-links";

describe("profile links", () => {
  it("accepts a labelled http or https address", () => {
    const links = [
      { label: "Hinge", url: "https://hinge.co/x" },
      { label: "Blog", url: "http://example.com" },
    ];
    expect(profileLinksSchema.safeParse(links).success).toBe(true);
    expect(readProfileLinks(links)).toEqual(links);
  });

  it("trims the label and the address", () => {
    expect(readProfileLinks([{ label: "  Hinge  ", url: " https://hinge.co " }])).toEqual([
      { label: "Hinge", url: "https://hinge.co" },
    ]);
  });

  // The reason the schema exists. These render as an anchor's href, so a stored
  // scheme other than http(s) is a self-XSS that survives every reload.
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("rejects %s", (url) => {
    expect(profileLinksSchema.safeParse([{ label: "Bad", url }]).success).toBe(false);
    expect(readProfileLinks([{ label: "Bad", url }])).toEqual([]);
  });

  it("rejects an address that is not a URL at all", () => {
    expect(readProfileLinks([{ label: "Nope", url: "hinge.co" }])).toEqual([]);
  });

  it("requires a label", () => {
    expect(readProfileLinks([{ label: "   ", url: "https://hinge.co" }])).toEqual([]);
  });

  it("caps the list at twenty", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      label: `Link ${i}`,
      url: `https://example.com/${i}`,
    }));
    expect(profileLinksSchema.safeParse(many).success).toBe(false);
  });

  // A column that predates any writer holds whatever it holds; the reader is
  // what stops that reaching the page.
  it.each([null, undefined, "https://hinge.co", 7, { label: "x" }, [{ url: "https://x.co" }]])(
    "reads %s as nothing",
    (value) => {
      expect(readProfileLinks(value)).toEqual([]);
    },
  );

  it("drops the whole list when one entry is bad", () => {
    expect(
      readProfileLinks([
        { label: "Good", url: "https://example.com" },
        { label: "Bad", url: "javascript:alert(1)" },
      ]),
    ).toEqual([]);
  });
});
