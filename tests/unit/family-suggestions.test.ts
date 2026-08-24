import { describe, expect, it } from "vitest";
import {
  pairKey,
  suggestFamilyLinks,
  type FamilyEdge,
} from "@/server/services/family-suggestions";
import type { FamilyRole } from "@/lib/family";

const NAMES: Record<string, string> = {
  me: "Me",
  mum: "Mum",
  dad: "Dad",
  gran: "Gran",
  ben: "Ben",
  dana: "Dana",
  sam: "Sam",
  rose: "Rose",
  kit: "Kit",
  stepdad: "Stepdad",
  aunt: "Aunt Jo",
};

const names = new Map(Object.entries(NAMES));

/** Records a relationship the way the app does: both directions. */
function link(a: string, b: string, role: FamilyRole, inverse: FamilyRole): FamilyEdge[] {
  return [
    { fromId: a, toId: b, role },
    { fromId: b, toId: a, role: inverse },
  ];
}

const parentOf = (child: string, parent: string) =>
  link(child, parent, "parent", "child");
const siblingOf = (a: string, b: string) => link(a, b, "sibling", "sibling");
const spouseOf = (a: string, b: string) => link(a, b, "spouse", "spouse");

function suggest(edges: FamilyEdge[], subject = "me", linked: string[] = []) {
  return suggestFamilyLinks({
    edges,
    names,
    linked: new Set(linked),
    subjectIds: [subject],
  });
}

describe("suggestFamilyLinks", () => {
  it("finds a grandparent through a parent", () => {
    const result = suggest([...parentOf("me", "mum"), ...parentOf("mum", "gran")]);
    const hit = result.find((s) => s.personId === "gran");
    expect(hit?.role).toBe("grandparent");
    expect(hit?.viaIds).toEqual(["mum"]);
    expect(hit?.reason).toContain("Mum is their parent");
  });

  it("finds an aunt through a parent's sibling", () => {
    const result = suggest([...parentOf("me", "mum"), ...siblingOf("mum", "aunt")]);
    expect(result.find((s) => s.personId === "aunt")?.role).toBe("aunt-uncle");
  });

  it("finds a niece through a sibling's child", () => {
    const result = suggest([...siblingOf("me", "ben"), ...parentOf("dana", "ben")]);
    expect(result.find((s) => s.personId === "dana")?.role).toBe("niece-nephew");
  });

  it("finds a cousin the long way round when no aunt link is recorded", () => {
    const result = suggest([
      ...parentOf("me", "mum"),
      ...siblingOf("mum", "aunt"),
      ...parentOf("kit", "aunt"),
    ]);
    const hit = result.find((s) => s.personId === "kit");
    expect(hit?.role).toBe("cousin");
    expect(hit?.viaIds).toEqual(["mum", "aunt"]);
  });

  it("finds in-laws through a partner", () => {
    const result = suggest([
      ...spouseOf("me", "sam"),
      ...parentOf("sam", "rose"),
      ...siblingOf("sam", "ben"),
    ]);
    expect(result.find((s) => s.personId === "rose")?.role).toBe("parent-in-law");
    expect(result.find((s) => s.personId === "ben")?.role).toBe("sibling-in-law");
  });

  it("finds a sibling's partner as a sibling-in-law", () => {
    const result = suggest([...siblingOf("me", "ben"), ...spouseOf("ben", "kit")]);
    expect(result.find((s) => s.personId === "kit")?.role).toBe("sibling-in-law");
  });

  it("suggests a sibling from a shared parent, and says it might be a half-sibling", () => {
    const result = suggest([...parentOf("me", "dad"), ...parentOf("ben", "dad")]);
    const hit = result.find((s) => s.personId === "ben");
    expect(hit?.role).toBe("sibling");
    expect(hit?.reason).toContain("half-sibling");
  });

  it("never walks through a stepparent", () => {
    // Stepdad's sister is not an aunt unless you say so.
    const edges: FamilyEdge[] = [
      ...link("me", "stepdad", "stepparent", "stepchild"),
      ...siblingOf("stepdad", "aunt"),
    ];
    expect(suggest(edges)).toEqual([]);
  });

  it("never walks through chosen family", () => {
    const edges: FamilyEdge[] = [
      ...link("me", "ben", "chosen-family", "chosen-family"),
      ...parentOf("ben", "rose"),
    ];
    expect(suggest(edges)).toEqual([]);
  });

  it("does not re-suggest a pair that is already linked", () => {
    const edges = [...parentOf("me", "mum"), ...parentOf("mum", "gran")];
    expect(suggest(edges, "me", [pairKey("me", "gran")])).toEqual([]);
  });

  it("does not suggest someone as their own relative", () => {
    // Mum recorded as her own parent's child, walked back to herself.
    const edges = [...parentOf("me", "mum"), ...parentOf("me", "dad")];
    const result = suggest(edges);
    expect(result.every((s) => s.personId !== "me")).toBe(true);
  });

  it("suggests each pair once, keeping the most confident rule", () => {
    // Ben is reachable as both a sibling (shared parent) and, via Dad's
    // sibling, nothing else — the sibling rule must win and fire once.
    const edges = [
      ...parentOf("me", "dad"),
      ...parentOf("ben", "dad"),
      ...siblingOf("me", "ben"),
    ];
    const result = suggest(edges, "me", [pairKey("me", "ben")]);
    expect(result.filter((s) => s.personId === "ben")).toHaveLength(0);
  });

  it("does not chain one suggestion into another", () => {
    // Gran is only a suggested grandparent; her siblings must not become
    // great-aunts off the back of it.
    const edges = [
      ...parentOf("me", "mum"),
      ...parentOf("mum", "gran"),
      ...siblingOf("gran", "rose"),
    ];
    const result = suggest(edges);
    expect(result.map((s) => s.personId).sort()).toEqual(["gran"]);
  });

  it("stops suggesting in-laws once a marriage has ended", () => {
    const edges: FamilyEdge[] = [
      ...link("me", "sam", "ex-spouse", "ex-spouse"),
      ...parentOf("sam", "rose"),
      ...siblingOf("sam", "ben"),
    ];
    // Rose and Ben stay wherever they were already recorded; they just stop
    // generating new suggestions through an ex.
    expect(suggest(edges)).toEqual([]);
  });

  it("keeps working through the parent link a divorce does not touch", () => {
    // Divorced parents still share children, so the shared-parent rule holds.
    const edges: FamilyEdge[] = [
      ...link("mum", "dad", "ex-spouse", "ex-spouse"),
      ...parentOf("me", "dad"),
      ...parentOf("ben", "dad"),
    ];
    expect(suggest(edges).find((s) => s.personId === "ben")?.role).toBe("sibling");
  });

  it("suggests a stepparent when a parent remarries", () => {
    const edges = [...parentOf("me", "dad"), ...spouseOf("dad", "kit")];
    const hit = suggest(edges).find((s) => s.personId === "kit");
    expect(hit?.role).toBe("stepparent");
    expect(hit?.reason).toContain("unless they are a parent you have not linked yet");
  });

  it("does not call your other parent a stepparent", () => {
    const edges = [
      ...parentOf("me", "dad"),
      ...parentOf("me", "mum"),
      ...spouseOf("dad", "mum"),
    ];
    expect(suggest(edges).some((s) => s.role === "stepparent")).toBe(false);
  });

  it("does not suggest an ex-partner of a parent as a stepparent", () => {
    const edges: FamilyEdge[] = [
      ...parentOf("me", "dad"),
      ...link("dad", "kit", "ex-spouse", "ex-spouse"),
    ];
    expect(suggest(edges)).toEqual([]);
  });

  it("returns nothing when there is nothing to go on", () => {
    expect(suggest([])).toEqual([]);
  });
});

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});
