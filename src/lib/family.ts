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

/**
 * One recorded family edge, reduced to what the graph walk needs.
 *
 * Kept structural rather than Prisma-shaped so the banding logic can be
 * exercised without a database — it is the part of `/family` most likely to
 * produce a wrong answer that still looks plausible on screen.
 */
export interface GenerationEdge {
  fromId: string;
  toId: string;
  /** Generation of `toId` relative to `fromId`; positive is older. */
  delta: number;
}

/**
 * Whose point of view the generations are measured from.
 *
 * With no explicit pick it is whoever has the most recorded family links,
 * which in a personal CRM is almost always the middle of the family you care
 * about. Ties break on id so the page does not reshuffle between renders.
 *
 * A `preferred` id that has no outgoing links is ignored rather than honoured:
 * anchoring on someone the walk cannot leave puts everyone else in their own
 * band and says nothing.
 */
export function pickAnchor(edges: GenerationEdge[], preferred?: string | null): string | null {
  const degree = new Map<string, number>();
  for (const edge of edges) degree.set(edge.fromId, (degree.get(edge.fromId) ?? 0) + 1);
  if (preferred && degree.has(preferred)) return preferred;

  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of degree) {
    if (count > bestCount || (count === bestCount && best !== null && id.localeCompare(best) < 0)) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** Where the walk placed someone, and how it got to them. */
export interface GenerationHop {
  /** Generation relative to the anchor; positive is older. */
  generation: number;
  /**
   * The person one step back along the shortest path — null for the anchor
   * itself. For someone the anchor is directly linked to this is the anchor;
   * for everyone further out it names the relative they hang off, which is the
   * only honest thing the tree can say about them without inventing a
   * relationship nobody recorded.
   */
  via: string | null;
}

/**
 * Breadth-first generation assignment from an anchor.
 *
 * Each edge carries its own generation delta, so "Gran is Mum's parent" lands
 * two bands above you without needing to know anything about family structure.
 * BFS means the shortest path wins, which keeps a cousin marriage or a
 * remarriage from dragging someone into a nonsensical band.
 *
 * Anyone with no path to the anchor is simply absent from the result; the
 * caller bands them at their own generation 0 rather than dropping them.
 */
export function walkGenerations(
  edges: GenerationEdge[],
  anchor: string,
): Map<string, GenerationHop> {
  const out = new Map<string, GenerationHop>([[anchor, { generation: 0, via: null }]]);
  const adjacency = new Map<string, GenerationEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromId);
    if (list) list.push(edge);
    else adjacency.set(edge.fromId, [edge]);
  }

  const queue = [anchor];
  // Index rather than `shift()`: shifting re-indexes the whole array on every
  // step, which is quadratic on a large family for no benefit.
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const base = out.get(current)!.generation;
    for (const edge of adjacency.get(current) ?? []) {
      if (out.has(edge.toId)) continue;
      out.set(edge.toId, { generation: base + edge.delta, via: current });
      queue.push(edge.toId);
    }
  }
  return out;
}

/**
 * The closest of several tiers, or null when there are none.
 *
 * Someone can be recorded more than one way at once — a sister-in-law who is
 * also a cousin, a stepfather you also record as a parent. The tree shows one
 * heading per person, and the closest reading is the one that belongs at the
 * top of the band.
 */
export function closestTier(tiers: readonly FamilyTier[]): FamilyTier | null {
  let best: FamilyTier | null = null;
  for (const tier of tiers) {
    if (best === null || FAMILY_TIER_ORDER.indexOf(tier) < FAMILY_TIER_ORDER.indexOf(best)) {
      best = tier;
    }
  }
  return best;
}

/** What {@link groupFamilyBand} needs to know about a person. */
export interface GroupablePerson {
  /** Closest tier among their direct links to the anchor; null when they have none. */
  tier: FamilyTier | null;
  /** Who the shortest path reached them through, when they are not directly linked. */
  via: { id: string; name: string } | null;
}

/** One labelled run of people inside a generation band. */
export interface FamilyGroup<T> {
  /** Stable across renders and independent of the label text. */
  key: string;
  label: string;
  people: T[];
}

/**
 * Split one generation band into the groups it should read as.
 *
 * A band is a generation, and a generation is not a relationship: banding
 * alone puts a cousin, a sibling-in-law and a stepsister beside your own
 * sister, which is the one thing you opened the page to tell apart. Tier is
 * already on every recorded link, so the split costs nothing and invents
 * nothing.
 *
 * People with no direct link to the anchor cannot be tiered — the app knows
 * only that they hang off someone else — so they are grouped by the relative
 * they were reached through and say so, rather than being guessed into a tier
 * beside relationships that were actually recorded. Keyed on that relative's
 * id, because two of them can share a display name.
 */
export function groupFamilyBand<T extends GroupablePerson>(
  people: readonly T[],
  anchorName: string | null,
): Array<FamilyGroup<T>> {
  const byTier = new Map<FamilyTier, T[]>();
  const byVia = new Map<string, { name: string; people: T[] }>();
  const unconnected: T[] = [];

  for (const person of people) {
    if (person.tier) {
      const list = byTier.get(person.tier);
      if (list) list.push(person);
      else byTier.set(person.tier, [person]);
    } else if (person.via) {
      const group = byVia.get(person.via.id);
      if (group) group.people.push(person);
      else byVia.set(person.via.id, { name: person.via.name, people: [person] });
    } else {
      unconnected.push(person);
    }
  }

  const groups: Array<FamilyGroup<T>> = [];
  for (const tier of FAMILY_TIER_ORDER) {
    const members = byTier.get(tier);
    if (members && members.length > 0) {
      groups.push({ key: `tier:${tier}`, label: FAMILY_TIER_LABELS[tier], people: members });
    }
  }

  const vias = [...byVia.entries()].sort(
    ([idA, a], [idB, b]) => a.name.localeCompare(b.name) || idA.localeCompare(idB),
  );
  for (const [id, group] of vias) {
    groups.push({ key: `via:${id}`, label: `Through ${group.name}`, people: group.people });
  }

  if (unconnected.length > 0) {
    groups.push({
      key: "unconnected",
      // Not "extended family": these people have relatives of their own and no
      // recorded path to this anchor at all. Saying so is the difference
      // between a gap you can fill and a relationship the app made up.
      label: anchorName ? `Not linked to ${anchorName}` : "Not linked to the tree",
      people: unconnected,
    });
  }

  return groups;
}
