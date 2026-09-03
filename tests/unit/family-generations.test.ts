import { describe, expect, it } from "vitest";
import {
  closestTier,
  groupFamilyBand,
  pickAnchor,
  walkGenerations,
  type GenerationEdge,
} from "@/lib/family";

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

    expect(bands.get("me")?.generation).toBe(0);
    expect(bands.get("mum")?.generation).toBe(1);
    expect(bands.get("gran")?.generation).toBe(2);
  });

  it("counts a grandchild two bands down", () => {
    const edges = [...pair("me", "kid"), ...pair("kid", "grandkid")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("kid")?.generation).toBe(-1);
    expect(bands.get("grandkid")?.generation).toBe(-2);
  });

  it("keeps a spouse in the same band as their partner", () => {
    const edges = [...pair("mum", "me"), ...spouses("mum", "dad")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("dad")?.generation).toBe(1);
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

    expect(bands.get("gran")?.generation).toBe(2);
    expect(bands.get("step-grandad")?.generation).toBe(2);
    expect(bands.get("uncle")?.generation).toBe(1);
    expect(bands.get("cousin")?.generation).toBe(0);
  });

  it("does not revisit the anchor, so a cycle cannot move it off zero", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum"), ...pair("gran", "me")];

    const bands = walkGenerations(edges, "me");

    expect(bands.get("me")?.generation).toBe(0);
  });

  it("leaves an unreachable person out entirely, for the caller to band at zero", () => {
    const edges = [...pair("mum", "me"), ...pair("stranger's mum", "stranger")];

    const bands = walkGenerations(edges, "me");

    expect(bands.has("stranger")).toBe(false);
    expect(bands.has("stranger's mum")).toBe(false);
  });

  it("bands an anchor with no links at all as themselves and nobody else", () => {
    expect([...walkGenerations([], "me")]).toEqual([["me", { generation: 0, via: null }]]);
  });

  it("names the relative each person was reached through", () => {
    const edges = [...pair("mum", "me"), ...pair("gran", "mum")];

    const bands = walkGenerations(edges, "me");

    // The anchor came from nowhere; a direct link came through the anchor; and
    // Gran hangs off Mum, which is the only thing the tree can honestly say
    // about her without inventing "grandmother".
    expect(bands.get("me")?.via).toBeNull();
    expect(bands.get("mum")?.via).toBe("me");
    expect(bands.get("gran")?.via).toBe("mum");
  });

  it("reports the shortest path's predecessor, not the last one tried", () => {
    const edges = [
      ...pair("mum", "me"),
      ...pair("gran", "mum"),
      ...spouses("gran", "grandad"),
      ...pair("grandad", "uncle"),
    ];

    const bands = walkGenerations(edges, "me");

    // Gran is reached through Mum, Grandad through Gran (they are married), and
    // Uncle through Grandad — each hop records the step that actually reached
    // it, so the tree can name the relative a person hangs off.
    expect(bands.get("gran")?.via).toBe("mum");
    expect(bands.get("grandad")?.via).toBe("gran");
    expect(bands.get("uncle")?.via).toBe("grandad");
  });

  it("terminates on a family that loops back on itself", () => {
    // Reciprocal edges are already a cycle in every fixture above; this is the
    // degenerate one, where the walk would revisit forever without the guard.
    const edges = [
      { fromId: "a", toId: "b", delta: 1 },
      { fromId: "b", toId: "a", delta: 1 },
    ];

    const bands = walkGenerations(edges, "a");

    expect(bands.get("a")?.generation).toBe(0);
    expect(bands.get("b")?.generation).toBe(1);
  });
});

describe("closestTier", () => {
  it("takes the closest reading when someone is recorded more than one way", () => {
    // A sister-in-law who is also a cousin belongs under the closer heading,
    // not under both and not under whichever was recorded first.
    expect(closestTier(["extended", "inlaw"])).toBe("extended");
    expect(closestTier(["former", "immediate"])).toBe("immediate");
    expect(closestTier(["chosen"])).toBe("chosen");
  });

  it("has nothing to say about someone with no direct link", () => {
    expect(closestTier([])).toBeNull();
  });
});

describe("groupFamilyBand", () => {
  const sister = { id: "sister", tier: "immediate" as const, via: null };
  const cousin = { id: "cousin", tier: "extended" as const, via: null };
  const inlaw = { id: "inlaw", tier: "inlaw" as const, via: null };

  it("keeps a cousin out of the group holding your sister", () => {
    // The whole point: a generation is not a relationship, and banding alone
    // set these three side by side.
    const groups = groupFamilyBand([cousin, inlaw, sister], "Wren");

    expect(groups.map((group) => group.label)).toEqual([
      "Immediate family",
      "Extended family",
      "In-laws",
    ]);
    expect(groups[0].people).toEqual([sister]);
    expect(groups[1].people).toEqual([cousin]);
  });

  it("orders tiers by closeness whatever order they arrived in", () => {
    const chosen = { id: "chosen", tier: "chosen" as const, via: null };
    const step = { id: "step", tier: "step" as const, via: null };
    const former = { id: "former", tier: "former" as const, via: null };

    const groups = groupFamilyBand([former, chosen, step, cousin, sister], null);

    expect(groups.map((group) => group.label)).toEqual([
      "Immediate family",
      "Extended family",
      "Step & half",
      "Chosen family",
      "Former family",
    ]);
  });

  it("groups the untiered under the relative they were reached through", () => {
    const gran = { id: "gran", tier: null, via: { id: "mum", name: "Mum" } };
    const grandad = { id: "grandad", tier: null, via: { id: "mum", name: "Mum" } };

    const groups = groupFamilyBand([gran, grandad], "Wren");

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Through Mum");
    expect(groups[0].people).toEqual([gran, grandad]);
  });

  it("keeps two connectors with the same name apart", () => {
    // The bug this repository has already had once, in the anchor picker: a
    // display name is not an identity, and merging these would file one
    // person's relatives under the other.
    const a = { id: "a", tier: null, via: { id: "sam-1", name: "Sam" } };
    const b = { id: "b", tier: null, via: { id: "sam-2", name: "Sam" } };

    const groups = groupFamilyBand([a, b], "Wren");

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual(["via:sam-1", "via:sam-2"]);
    expect(groups.every((group) => group.label === "Through Sam")).toBe(true);
  });

  it("puts recorded relationships ahead of inferred paths", () => {
    const gran = { id: "gran", tier: null, via: { id: "mum", name: "Mum" } };

    const groups = groupFamilyBand([gran, cousin], "Wren");

    expect(groups.map((group) => group.label)).toEqual(["Extended family", "Through Mum"]);
  });

  it("says plainly when someone has no path to the anchor at all", () => {
    const stranger = { id: "stranger", tier: null, via: null };

    const groups = groupFamilyBand([stranger, sister], "Wren");

    expect(groups.map((group) => group.label)).toEqual([
      "Immediate family",
      "Not linked to Wren",
    ]);
    // Anchorless trees still have to name the group.
    expect(groupFamilyBand([stranger], null)[0].label).toBe("Not linked to the tree");
  });

  it("has no groups for an empty band", () => {
    expect(groupFamilyBand([], "Wren")).toEqual([]);
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
