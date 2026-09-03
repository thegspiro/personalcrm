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
});
