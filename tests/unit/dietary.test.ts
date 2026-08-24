import { describe, expect, it } from "vitest";
import {
  DIETARY_GROUPS,
  DIETARY_KINDS,
  DIETARY_KIND_LABELS,
  dietaryKindOf,
  mustAvoid,
} from "@/lib/dietary";

describe("dietary kinds", () => {
  it("treats everything but a stated preference as a hard avoid", () => {
    expect(mustAvoid("ALLERGY")).toBe(true);
    expect(mustAvoid("INTOLERANCE")).toBe(true);
    expect(mustAvoid("MEDICAL")).toBe(true);
    expect(mustAvoid("PREFERENCE")).toBe(false);
  });

  it("labels every kind", () => {
    for (const kind of DIETARY_KINDS) {
      expect(DIETARY_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("offers no severity scale", () => {
    // Prior mild reactions do not predict future severe ones, so there must be
    // no way to write "mild" beside an allergy and feel reassured. If a grading
    // vocabulary ever appears in this module, this fails.
    const vocabulary = [...DIETARY_KINDS, ...Object.values(DIETARY_KIND_LABELS)].join(" ");
    expect(vocabulary).not.toMatch(/mild|moderate|severe|minor|major|level|grade/i);
  });

  it("renders exactly two groups, whatever the kinds", () => {
    // Four kinds must never become four visible tiers — that is a severity
    // scale by another name.
    expect(DIETARY_GROUPS).toHaveLength(2);
    expect(DIETARY_GROUPS.flatMap((group) => [...group.kinds]).sort()).toEqual(
      [...DIETARY_KINDS].sort(),
    );
  });

  it("defaults unrecognised input to the stricter class", () => {
    // The error costs are asymmetric: filing a preference as an allergy wastes
    // a menu choice, the reverse is a hospital.
    expect(dietaryKindOf(undefined)).toBe("ALLERGY");
    expect(dietaryKindOf("nonsense")).toBe("ALLERGY");
    expect(dietaryKindOf("PREFERENCE")).toBe("PREFERENCE");
  });
});
