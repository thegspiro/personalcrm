import { describe, expect, it } from "vitest";
import { applyCap } from "@/lib/list-cap";

describe("applyCap", () => {
  it("reports nothing left behind when the extra row never came back", () => {
    // Nineteen rows from a `take: 21` query: the cap did not bite.
    const { items, truncated } = applyCap(Array.from({ length: 19 }, (_, i) => i), 20);

    expect(items).toHaveLength(19);
    expect(truncated).toBe(false);
  });

  it("does not cry truncation on a list that is exactly full", () => {
    // The whole reason the query asks for cap + 1. Twenty rows back from a
    // `take: 21` means twenty rows exist, not that the twenty-first is hiding.
    const { items, truncated } = applyCap(Array.from({ length: 20 }, (_, i) => i), 20);

    expect(items).toHaveLength(20);
    expect(truncated).toBe(false);
  });

  it("trims the probe row off and says the list was cut", () => {
    const { items, truncated } = applyCap(Array.from({ length: 21 }, (_, i) => i), 20);

    expect(items).toHaveLength(20);
    expect(items.at(-1)).toBe(19);
    expect(truncated).toBe(true);
  });

  it("keeps the order it was given", () => {
    const { items } = applyCap(["c", "a", "b"], 2);
    expect(items).toEqual(["c", "a"]);
  });

  it("survives a nonsense cap rather than throwing inside a render", () => {
    expect(applyCap([1, 2, 3], 0)).toEqual({ items: [], truncated: true });
    expect(applyCap([1, 2, 3], -5)).toEqual({ items: [], truncated: true });
    expect(applyCap([1, 2, 3], 2.7)).toEqual({ items: [1, 2], truncated: true });
  });

  it("leaves the caller's array alone", () => {
    const source = [1, 2, 3];
    applyCap(source, 1);
    expect(source).toEqual([1, 2, 3]);
  });
});
