import { describe, expect, it } from "vitest";
import { pickAnchor, walkGenerations, type GenerationEdge } from "@/lib/family";

/**
 * The banding behind `/family`.
 *
 * This is the part of the page most able to produce a confidently wrong
 * answer: a generation is a small integer, so a grandmother filed one band too
 * low looks like an ordinary row rather than an error. Until now it was only
 * exercised through one end-to-end assertion.
 *
 * Edges are stored in both directions by every write path, so the fixtures
 * below record both halves, mirroring the generation the way the seeded
 * taxonomy does.
 */
function pair(parentId: string, childId: string): GenerationEdge[] {
  return [
    // "parent is child's parent" — a generation up from the child.
    { fromId: childId, toId: parentId, delta: 1 },
    { fromId: parentId, toId: childId, delta: -1 },
  ];
}

function spouses(a: string, b: string): GenerationEdge[] {
  return [
    { fromId: a, toId: b, delta: 0 },
    { fromId: b, toId: a, delta: 0 },
  ];
}

describe("walkGenerations", () => {
  it("counts a grandparent two bands up through a parent", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("me")).toBe(0);
    expect(bands.get("mum")).toBe(1);
    expect(bands.get("gran")).toBe(2);
  });

  it("counts a grandchild two bands down", () => {
    const edges = [...pair("me", "kid"), ...pair("kid", "grandkid")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("kid")).toBe(-1);
    expect(bands.get("grandkid")).toBe(-2);
  });

  it("keeps a spouse in the same band as their partner", () => {
    const edges = [...pair("mum", "me"), ...spouses("mum", "dad")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("dad")).toBe(1);
  });

  it("takes the shortest path, so a remarriage cannot drag someone off-band", () => {
    // Gran is reachable directly (two up) and, once she remarries into the
    // family, round the houses as well. Breadth-first means the direct route
    // is the one that lands.
    const edges = [
      ...pair("mum", "me"),
      ...pair("gran", "mum"),
      ...spouses("gran", "step-grandad"),
      ...pair("step-grandad", "uncle"),
      ...pair("uncle", "cousin"),
    ];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("gran")).toBe(2);
    expect(bands.get("step-grandad")).toBe(2);
    expect(bands.get("uncle")).toBe(1);
    expect(bands.get("cousin")).toBe(0);
  });

  it("does not revisit the anchor, so a cycle cannot move it off zero", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum"), ...pair("gran", "me")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("me")).toBe(0);
  });

  it("leaves an unreachable person out entirely, for the caller to band at zero", () => {
    const edges = [...pair("mum", "me"), ...pair("stranger's mum", "stranger")];

    const bands = walkGenerations(edges, "me");

    expect(bands.has("stranger")).toBe(false);
    expect(bands.has("stranger's mum")).toBe(false);
  });

  it("bands an anchor with no links at all as themselves and nobody else", () => {
    expect([...walkGenerations([], "me")]).toEqual([["me", 0]]);
  });

  it("terminates on a family that loops back on itself", () => {
    // Reciprocal edges are already a cycle in every fixture above; this is the
    // degenerate one, where the walk would revisit forever without the guard.
    const edges = [
      { fromId: "a", toId: "b", delta: 1 },
      { fromId: "b", toId: "a", delta: 1 },
    ];

    const bands = walkGenerations(edges, "a");

    expect(bands.get("a")).toBe(0);
    expect(bands.get("b")).toBe(1);
  });
});

describe("pickAnchor", () => {
  it("honours a person who has links of their own", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum")];

    expect(pickAnchor(edges, "me")).toBe("me");
  });

  it("falls back to the best-connected person when the pick has no links", () => {
    // "mum" sits on two edges; everyone else on one. Anchoring on a stranger
    // would put every single person in a band of their own.
    const edges = [...pair("mum", "me"), ...pair("gran", "mum")];

    expect(pickAnchor(edges, "stranger")).toBe("mum");
  });

  it("falls back the same way when nothing is picked at all", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum")];

    expect(pickAnchor(edges)).toBe("mum");
  });

  it("breaks a tie on id, so the page does not reshuffle between renders", () => {
    const edges = spouses("bea", "abe");

    expect(pickAnchor(edges)).toBe("abe");
    expect(pickAnchor([...edges].reverse())).toBe("abe");
  });

  it("has no anchor to offer when nothing is recorded", () => {
    expect(pickAnchor([])).toBeNull();
    expect(pickAnchor([], "me")).toBeNull();
  });
});
