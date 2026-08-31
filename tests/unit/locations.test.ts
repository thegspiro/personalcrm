import { describe, expect, it } from "vitest";
import { normalizeLocationName } from "@/server/services/locations";

describe("normalizeLocationName", () => {
  it("folds case and repeated whitespace without guessing at fuzzy aliases", () => {
    expect(normalizeLocationName("  Northside   Café ")).toBe("northside café");
    expect(normalizeLocationName("The Alamo")).not.toBe(normalizeLocationName("Alamo"));
  });
});
