import { describe, expect, it } from "vitest";
import {
  appliesTo,
  coerceFieldValue,
  definitionIdFromInputName,
  fieldInputName,
  fieldOptions,
  fieldValueAsDate,
  fieldValueAsList,
  isEmptyFieldValue,
  LONGTEXT_MAX,
  slugifyFieldKey,
  TEXT_MAX,
  type DefinitionLike,
} from "@/lib/custom-fields";
import type { CustomFieldType } from "@prisma/client";

const def = (fieldType: CustomFieldType, extra: Partial<DefinitionLike> = {}): DefinitionLike => ({
  fieldType,
  ...extra,
});

/** Every coercion must succeed or fail — never throw. */
function coerce(definition: DefinitionLike, raw: unknown) {
  return coerceFieldValue(definition, raw);
}

describe("coerceFieldValue", () => {
  it("clears a field when the box is left blank", () => {
    for (const type of ["TEXT", "LONGTEXT", "NUMBER", "DATE", "SELECT", "URL"] as const) {
      expect(coerce(def(type), ""), type).toEqual({ ok: true, value: null });
      expect(coerce(def(type), "   "), type).toEqual({ ok: true, value: null });
      expect(coerce(def(type), undefined), type).toEqual({ ok: true, value: null });
    }
  });

  it("trims text and enforces a cap", () => {
    expect(coerce(def("TEXT"), "  hello  ")).toEqual({ ok: true, value: "hello" });
    expect(coerce(def("TEXT"), "x".repeat(TEXT_MAX))).toEqual({
      ok: true,
      value: "x".repeat(TEXT_MAX),
    });
    expect(coerce(def("TEXT"), "x".repeat(TEXT_MAX + 1)).ok).toBe(false);
  });

  it("allows long text well past the short cap", () => {
    expect(coerce(def("LONGTEXT"), "x".repeat(TEXT_MAX + 1)).ok).toBe(true);
    expect(coerce(def("LONGTEXT"), "x".repeat(LONGTEXT_MAX + 1)).ok).toBe(false);
  });

  it("accepts numbers, including negative and decimal", () => {
    expect(coerce(def("NUMBER"), "42")).toEqual({ ok: true, value: 42 });
    expect(coerce(def("NUMBER"), "-3.5")).toEqual({ ok: true, value: -3.5 });
    expect(coerce(def("NUMBER"), "0")).toEqual({ ok: true, value: 0 });
  });

  it("rejects things that are not numbers", () => {
    for (const raw of ["banana", "12abc", "Infinity", "NaN", "1/2"]) {
      expect(coerce(def("NUMBER"), raw).ok, raw).toBe(false);
    }
  });

  it("stores a date as a plain key, not a timestamp", () => {
    // A calendar date round-tripped through a Date shifts across a timezone
    // boundary, which is why these are stored as YYYY-MM-DD.
    expect(coerce(def("DATE"), "2026-03-14")).toEqual({ ok: true, value: "2026-03-14" });
  });

  it("rejects impossible dates", () => {
    for (const raw of ["2026-02-30", "not-a-date", "2026-13-01", "14/03/2026"]) {
      expect(coerce(def("DATE"), raw).ok, raw).toBe(false);
    }
  });

  it("treats a missing boolean as false", () => {
    // Unchecked checkboxes never appear in a FormData at all.
    expect(coerce(def("BOOLEAN"), undefined)).toEqual({ ok: true, value: false });
    expect(coerce(def("BOOLEAN"), "")).toEqual({ ok: true, value: false });
    expect(coerce(def("BOOLEAN"), "on")).toEqual({ ok: true, value: true });
    expect(coerce(def("BOOLEAN"), "true")).toEqual({ ok: true, value: true });
    expect(coerce(def("BOOLEAN"), false)).toEqual({ ok: true, value: false });
  });

  it("holds a SELECT to its own option list", () => {
    const select = def("SELECT", { options: ["Red", "Green"] });
    expect(coerce(select, "Red")).toEqual({ ok: true, value: "Red" });
    expect(coerce(select, "Blue").ok).toBe(false);
    // Case matters — the options are the user's own strings.
    expect(coerce(select, "red").ok).toBe(false);
  });

  it("rejects a SELECT value when the definition has no options", () => {
    expect(coerce(def("SELECT"), "anything").ok).toBe(false);
  });

  it("collects and de-duplicates a MULTISELECT", () => {
    const multi = def("MULTISELECT", { options: ["A", "B", "C"] });
    expect(coerce(multi, ["A", "C", "A"])).toEqual({ ok: true, value: ["A", "C"] });
    expect(coerce(multi, "B")).toEqual({ ok: true, value: ["B"] });
    expect(coerce(multi, [])).toEqual({ ok: true, value: null });
    expect(coerce(multi, ["A", "Z"]).ok).toBe(false);
  });

  it("adds a scheme to a bare URL and rejects non-web ones", () => {
    expect(coerce(def("URL"), "example.com/x")).toEqual({
      ok: true,
      value: "https://example.com/x",
    });
    expect(coerce(def("URL"), "http://example.com/")).toEqual({
      ok: true,
      value: "http://example.com/",
    });
    // A javascript: URL stored and later rendered as a link is an XSS vector.
    expect(coerce(def("URL"), "javascript:alert(1)").ok).toBe(false);
    expect(coerce(def("URL"), "not a url at all").ok).toBe(false);
  });
});

describe("appliesTo", () => {
  it("applies to everyone when unscoped", () => {
    expect(appliesTo({}, "cat-1")).toBe(true);
    expect(appliesTo({ appliesToCategoryIds: null }, "cat-1")).toBe(true);
    expect(appliesTo({ appliesToCategoryIds: [] }, null)).toBe(true);
  });

  it("applies only to the listed categories once scoped", () => {
    const scoped = { appliesToCategoryIds: ["cat-1", "cat-2"] };
    expect(appliesTo(scoped, "cat-1")).toBe(true);
    expect(appliesTo(scoped, "cat-3")).toBe(false);
    // Someone with no category is not in any of them.
    expect(appliesTo(scoped, null)).toBe(false);
  });
});

describe("fieldOptions", () => {
  it("reads a JSON array and ignores anything else", () => {
    expect(fieldOptions({ options: ["A", "B"] })).toEqual(["A", "B"]);
    expect(fieldOptions({ options: ["A", "", 3, null] })).toEqual(["A"]);
    expect(fieldOptions({ options: "A,B" })).toEqual([]);
    expect(fieldOptions({})).toEqual([]);
  });
});

describe("value readers", () => {
  it("reads a stored date back", () => {
    expect(fieldValueAsDate("2026-03-14")).toEqual({ year: 2026, month: 3, day: 14 });
    expect(fieldValueAsDate(20260314)).toBeNull();
    expect(fieldValueAsDate(null)).toBeNull();
  });

  it("reads a stored list back", () => {
    expect(fieldValueAsList(["A", "B"])).toEqual(["A", "B"]);
    expect(fieldValueAsList("A")).toEqual([]);
  });

  it("knows what counts as unset", () => {
    expect(isEmptyFieldValue(null)).toBe(true);
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    // False and zero are values someone chose, not absences.
    expect(isEmptyFieldValue(false)).toBe(false);
    expect(isEmptyFieldValue(0)).toBe(false);
  });
});

describe("form field names", () => {
  it("round-trips a definition id", () => {
    const name = fieldInputName("abc123");
    expect(definitionIdFromInputName(name)).toBe("abc123");
  });

  it("ignores built-in form fields", () => {
    // The prefix is what keeps a custom field from colliding with firstName.
    expect(definitionIdFromInputName("firstName")).toBeNull();
    expect(definitionIdFromInputName("categoryId")).toBeNull();
  });
});

describe("slugifyFieldKey", () => {
  it("makes a stable key from a label", () => {
    expect(slugifyFieldKey("Favourite tea")).toBe("favourite-tea");
    expect(slugifyFieldKey("  Kids' names!  ")).toBe("kids-names");
    expect(slugifyFieldKey("Café order")).toBe("cafe-order");
  });

  it("always produces something usable", () => {
    expect(slugifyFieldKey("???")).toBe("field");
    expect(slugifyFieldKey("")).toBe("field");
    expect(slugifyFieldKey("x".repeat(200)).length).toBeLessThanOrEqual(96);
  });
});
