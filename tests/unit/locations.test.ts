import { describe, expect, it } from "vitest";
import { normalizeLocationName } from "@/lib/locations";

describe("normalizeLocationName", () => {
  it("trims, collapses whitespace, and folds case", () => {
    expect(normalizeLocationName("  Northside\n  CAFE ")).toBe("northside cafe");
  });
});
