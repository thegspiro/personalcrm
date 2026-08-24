/**
 * Reading the family metadata off relationship taxonomy terms.
 *
 * Pure and dependency-free so both the server (tree building, inference) and
 * the client (section grouping) can use it, and so it is unit-testable without
 * a database.
 *
 * Terms without family metadata are not family — that includes anything the
 * user invents. Everything here degrades to "unknown" rather than guessing.
 */

export type FamilyTier = "immediate" | "extended" | "inlaw" | "step" | "chosen" | "former";

/**
 * Stable semantic keys for the seeded family terms. Inference matches on these
 * rather than on slugs or labels, so a renamed term keeps working.
 */
export type FamilyRole =
  | "spouse"
  | "parent"
  | "child"
  | "sibling"
  | "grandparent"
  | "grandchild"
  | "aunt-uncle"
  | "niece-nephew"
  | "cousin"
  | "parent-in-law"
  | "child-in-law"
  | "sibling-in-law"
  | "stepparent"
  | "stepchild"
  | "stepsibling"
  | "half-sibling"
  | "godparent"
  | "godchild"
  | "chosen-family"
  | "ex-spouse"
  | "ex-parent-in-law"
  | "ex-child-in-law"
  | "ex-sibling-in-law"
  | "ex-stepparent"
  | "ex-stepchild"
  | "ex-stepsibling";

export interface FamilyMeta {
  tier: FamilyTier;
  /** Referent's generation relative to the subject; positive is older. */
  generation: number;
  role: FamilyRole | null;
}

/** Minimal shape needed to read metadata — anything term-like will do. */
export interface TermLike {
  metadata?: unknown;
}

const TIERS: FamilyTier[] = ["immediate", "extended", "inlaw", "step", "chosen", "former"];

export const FAMILY_TIER_LABELS: Record<FamilyTier, string> = {
  immediate: "Immediate family",
  extended: "Extended family",
  inlaw: "In-laws",
  step: "Step & half",
  chosen: "Chosen family",
  former: "Former family",
};

/** Display order for the grouped Family section and the tree's legend. */
export const FAMILY_TIER_ORDER = TIERS;

export function familyMeta(term: TermLike | null | undefined): FamilyMeta | null {
  const meta = term?.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const record = meta as Record<string, unknown>;
  if (record.family !== true) return null;

  const tier = TIERS.includes(record.tier as FamilyTier)
    ? (record.tier as FamilyTier)
    : "extended";
  const generation = typeof record.generation === "number" ? record.generation : 0;
  const role = typeof record.role === "string" ? (record.role as FamilyRole) : null;

  return { tier, generation, role };
}

export function isFamilyTerm(term: TermLike | null | undefined): boolean {
  return familyMeta(term) !== null;
}

/**
 * What a relationship becomes when it ends.
 *
 * Divorce and separation do not delete anyone: you may well still see your
 * ex-mother-in-law at the kids' birthdays. Ending a relationship re-types it
 * so the history and every note survive, and the person stays in the family
 * where you can keep track of them.
 *
 * Blood relations are absent on purpose — a sibling does not stop being one.
 */
const ENDINGS: Partial<Record<FamilyRole, FamilyRole>> = {
  spouse: "ex-spouse",
  "parent-in-law": "ex-parent-in-law",
  "child-in-law": "ex-child-in-law",
  "sibling-in-law": "ex-sibling-in-law",
  stepparent: "ex-stepparent",
  stepchild: "ex-stepchild",
  stepsibling: "ex-stepsibling",
};

/** The "former" counterpart of a role, or null if this one cannot end. */
export function endedRole(role: FamilyRole | null | undefined): FamilyRole | null {
  return role ? (ENDINGS[role] ?? null) : null;
}

/** Roles that describe a relationship that has already ended. */
export function isEndedRole(role: FamilyRole | null | undefined): boolean {
  return role ? Object.values(ENDINGS).includes(role) : false;
}

/**
 * Labels for the generation bands in the tree.
 *
 * Phrased around the anchor rather than the viewer: the tree is rooted on a
 * contact, so "your generation" would be a lie whenever the anchor is your
 * grandmother. Beyond great-grandparents it degrades to a count rather than
 * inventing more "great"s.
 */
export function generationLabel(generation: number, anchorName?: string | null): string {
  const whose = anchorName ? `${possessive(anchorName)} ` : "";
  switch (generation) {
    case 3:
      return `${whose}great-grandparents`.trim();
    case 2:
      return `${whose}grandparents`.trim();
    case 1:
      return anchorName ? `${possessive(anchorName)} parents' generation` : "Parents' generation";
    case 0:
      return anchorName ? `${possessive(anchorName)} generation` : "Same generation";
    case -1:
      return anchorName
        ? `${possessive(anchorName)} children's generation`
        : "Children's generation";
    case -2:
      return `${whose}grandchildren`.trim();
    case -3:
      return `${whose}great-grandchildren`.trim();
    default:
      return generation > 0
        ? `${generation} generations up`
        : `${Math.abs(generation)} generations down`;
  }
}

/** "Dad" → "Dad's", "Chris" → "Chris'". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}
