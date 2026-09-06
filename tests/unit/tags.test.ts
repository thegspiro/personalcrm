import { describe, expect, it } from "vitest";
import { normalizeTagSlug } from "@/lib/tags";

describe("normalizeTagSlug", () => {
  it.each([
    [" Close Friends ", "close-friends"],
    ["Café & Family", "cafe-family"],
    ["Work---Friends", "work-friends"],
    ["---", ""],
  ])("normalizes %s", (input, expected) =>
    expect(normalizeTagSlug(input)).toBe(expected),
  );

  it("does not leave a partial separator at the length limit", () => {
    expect(normalizeTagSlug(`${"a".repeat(95)} hello`)).toBe("a".repeat(95));
  });

  it("keeps a name written in a script with no ASCII spelling", () => {
    // Folding to [a-z0-9] emptied these, and the action then refused a
    // perfectly good tag name with "Use at least one letter or number."
    expect(normalizeTagSlug("\u670b\u53cb")).toBe("\u670b\u53cb");
    expect(normalizeTagSlug("\u0414\u0440\u0443\u0437\u044c\u044f")).toBe(
      "\u0434\u0440\u0443\u0437\u044c\u044f",
    );
    // The hamza is a combining mark. It survives the decomposition rather than
    // becoming a separator: splitting there would have folded two different
    // words onto one key, which is also why the mark strip stays limited to
    // the Latin range instead of taking every \p{M}.
    const arabic = "\u0623\u0635\u062f\u0642\u0627\u0621";
    expect(normalizeTagSlug(arabic)).toBe(arabic.normalize("NFKD"));
    expect(normalizeTagSlug(arabic)).not.toContain("-");
    // Latin accents still fold, so "Café" and "Cafe" stay one tag.
    expect(normalizeTagSlug("Caf\u00e9")).toBe(normalizeTagSlug("Cafe"));
    // Nothing with a letter or a number in it at all still has no key.
    expect(normalizeTagSlug("\u{1f389}")).toBe("");
  });

  it("never cuts a surrogate pair at the length limit", () => {
    // A letter outside the basic plane is two UTF-16 units; slicing between
    // them stores a lone surrogate that utf8mb4 cannot represent.
    const slug = normalizeTagSlug("\u{20000}".repeat(200));
    expect([...slug]).toHaveLength(96);
    expect(slug).toBe(JSON.parse(JSON.stringify(slug)));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(slug)).toBe(false);
  });
});
