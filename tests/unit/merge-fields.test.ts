import { describe, expect, it } from "vitest";
import { isConflict, isFilledFromOther, MERGE_FIELDS, pairedField } from "@/lib/merge-fields";

describe("what counts as a conflict worth asking about", () => {
  it("treats two different answers as a conflict", () => {
    expect(isConflict("Leeds", "York")).toBe(true);
    expect(isConflict(30, 90)).toBe(true);
  });

  it("does not ask when only one side has an answer", () => {
    // Something beats nothing; asking would be asking somebody to confirm it.
    expect(isConflict("Leeds", null)).toBe(false);
    expect(isConflict(null, "York")).toBe(false);
    expect(isConflict("", "York")).toBe(false);
  });

  it("does not ask when the answers agree", () => {
    expect(isConflict("Leeds", "Leeds")).toBe(false);
    expect(isConflict(new Date("2026-01-02"), new Date("2026-01-02"))).toBe(false);
  });

  it("compares dates by their instant, not their identity", () => {
    expect(isConflict(new Date("2026-01-02"), new Date("2026-03-04"))).toBe(true);
  });

  it("knows when a field simply fills in from the other side", () => {
    expect(isFilledFromOther(null, "York")).toBe(true);
    expect(isFilledFromOther("Leeds", "York")).toBe(false);
    expect(isFilledFromOther(null, null)).toBe(false);
  });
});

describe("fields that travel together", () => {
  it("carries a date's precision with the date", () => {
    // Invariant 8: a partial date stays partial. Taking one record's day and
    // the other's precision would turn "sometime in 2019" into a Tuesday.
    expect(pairedField("birthDate")).toBe("birthDatePrecision");
    expect(pairedField("metOn")).toBe("metOnPrecision");
  });

  it("does not pair a field with itself", () => {
    expect(pairedField("categoryId")).toBeNull();
    expect(pairedField("city")).toBeNull();
  });

  it("never offers a column the merge service would refuse", () => {
    // The screen and the service have to agree on what is choosable.
    for (const spec of MERGE_FIELDS) {
      expect(spec.field).not.toMatch(/^(id|ownerId|isPrivate|lastInteractionAt|nextTouchAt)$/);
    }
  });
});
