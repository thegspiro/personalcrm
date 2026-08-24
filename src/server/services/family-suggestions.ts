/**
 * Working out family links you have not recorded yet.
 *
 * Everything here is a *suggestion*. Nothing in this file writes; the caller
 * shows each one with its reasoning and only creates the link if you accept it.
 * That is deliberate — family is full of arrangements a graph walk gets wrong
 * (adoption, estrangement, half-siblings recorded as siblings, a stepparent
 * everyone calls Dad), and silently inventing relationships between real people
 * is worse than missing a few.
 *
 * Two rules keep it honest:
 *
 * - **Only recorded edges are traversed.** A suggestion is never built on top
 *   of another suggestion, so accepting one cannot cascade into a dozen more.
 * - **Only blood/marriage roles are traversed** — parent, child, sibling,
 *   spouse. Step, godparent and chosen-family links are endpoints, never paths:
 *   your stepfather's sister is not your aunt unless you say she is.
 *
 * Pure and free of Prisma so it can be unit-tested directly.
 */
import type { FamilyRole } from "@/lib/family";

export interface FamilyEdge {
  fromId: string;
  toId: string;
  /** Role of `toId` relative to `fromId`: "toId is fromId's <role>". */
  role: FamilyRole;
}

export interface FamilySuggestion {
  /** The person whose page this suggestion belongs on. */
  subjectId: string;
  /** The person being suggested as a relative of the subject. */
  personId: string;
  /** Suggested role of `personId` relative to `subjectId`. */
  role: FamilyRole;
  /** Plain-language justification, shown next to the accept button. */
  reason: string;
  /** Contacts the inference passed through, for highlighting in the tree. */
  viaIds: string[];
}

export interface SuggestInput {
  /** Recorded family edges. Both directions are expected to be present. */
  edges: FamilyEdge[];
  /** Display names, for the reasoning text. */
  names: Map<string, string>;
  /**
   * Pairs that already have *any* relationship, keyed with {@link pairKey}.
   * Includes non-family links, so someone already recorded as a friend is not
   * re-suggested as a cousin.
   */
  linked: Set<string>;
  /** Limit suggestions to these subjects. Omit for everyone. */
  subjectIds?: string[];
}

/** Order-independent key for a pair of contacts. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Roles safe to walk *through*. Step, chosen and ended links are endpoints
 * only — see the module comment.
 */
const TRAVERSABLE: FamilyRole[] = ["parent", "child", "sibling", "spouse"];

type Index = Map<string, Map<FamilyRole, string[]>>;

function buildIndex(edges: FamilyEdge[]): Index {
  const index: Index = new Map();
  for (const edge of edges) {
    if (edge.fromId === edge.toId) continue;
    let byRole = index.get(edge.fromId);
    if (!byRole) index.set(edge.fromId, (byRole = new Map()));
    const list = byRole.get(edge.role);
    if (list) {
      if (!list.includes(edge.toId)) list.push(edge.toId);
    } else {
      byRole.set(edge.role, [edge.toId]);
    }
  }
  return index;
}

function related(index: Index, id: string, role: FamilyRole): string[] {
  return index.get(id)?.get(role) ?? [];
}

/**
 * The inference rules, most confident first. Ties are resolved by this order:
 * a pair reachable two ways keeps the earlier rule's role.
 */
interface Rule {
  role: FamilyRole;
  /** Yields [personId, viaId[], reason-parts] for a given subject. */
  run(index: Index, subject: string, name: (id: string) => string): Array<{
    personId: string;
    viaIds: string[];
    reason: string;
  }>;
}

/** "X is their <role>" — first clause of most reasons. */
function theirs(name: string, role: string): string {
  return `${name} is their ${role}`;
}

const RULES: Rule[] = [
  {
    role: "grandparent",
    run: (index, subject, name) =>
      related(index, subject, "parent").flatMap((parent) =>
        related(index, parent, "parent").map((grandparent) => ({
          personId: grandparent,
          viaIds: [parent],
          reason: `${theirs(name(parent), "parent")}, and ${name(grandparent)} is ${name(parent)}'s parent.`,
        })),
      ),
  },
  {
    role: "grandchild",
    run: (index, subject, name) =>
      related(index, subject, "child").flatMap((child) =>
        related(index, child, "child").map((grandchild) => ({
          personId: grandchild,
          viaIds: [child],
          reason: `${theirs(name(child), "child")}, and ${name(grandchild)} is ${name(child)}'s child.`,
        })),
      ),
  },
  {
    role: "sibling",
    run: (index, subject, name) =>
      related(index, subject, "parent").flatMap((parent) =>
        related(index, parent, "child")
          .filter((sibling) => sibling !== subject)
          .map((sibling) => ({
            personId: sibling,
            viaIds: [parent],
            reason: `They and ${name(sibling)} both have ${name(parent)} recorded as a parent — check whether that makes them half-siblings.`,
          })),
      ),
  },
  {
    role: "aunt-uncle",
    run: (index, subject, name) =>
      related(index, subject, "parent").flatMap((parent) =>
        related(index, parent, "sibling").map((auntUncle) => ({
          personId: auntUncle,
          viaIds: [parent],
          reason: `${theirs(name(parent), "parent")}, and ${name(auntUncle)} is ${name(parent)}'s sibling.`,
        })),
      ),
  },
  {
    role: "niece-nephew",
    run: (index, subject, name) =>
      related(index, subject, "sibling").flatMap((sibling) =>
        related(index, sibling, "child").map((nieceNephew) => ({
          personId: nieceNephew,
          viaIds: [sibling],
          reason: `${theirs(name(sibling), "sibling")}, and ${name(nieceNephew)} is ${name(sibling)}'s child.`,
        })),
      ),
  },
  {
    role: "parent-in-law",
    run: (index, subject, name) =>
      related(index, subject, "spouse").flatMap((spouse) =>
        related(index, spouse, "parent").map((parentInLaw) => ({
          personId: parentInLaw,
          viaIds: [spouse],
          reason: `${theirs(name(spouse), "partner")}, and ${name(parentInLaw)} is ${name(spouse)}'s parent.`,
        })),
      ),
  },
  {
    role: "child-in-law",
    run: (index, subject, name) =>
      related(index, subject, "child").flatMap((child) =>
        related(index, child, "spouse").map((childInLaw) => ({
          personId: childInLaw,
          viaIds: [child],
          reason: `${theirs(name(child), "child")}, and ${name(childInLaw)} is ${name(child)}'s partner.`,
        })),
      ),
  },
  {
    role: "sibling-in-law",
    run: (index, subject, name) => [
      ...related(index, subject, "spouse").flatMap((spouse) =>
        related(index, spouse, "sibling").map((siblingInLaw) => ({
          personId: siblingInLaw,
          viaIds: [spouse],
          reason: `${theirs(name(spouse), "partner")}, and ${name(siblingInLaw)} is ${name(spouse)}'s sibling.`,
        })),
      ),
      ...related(index, subject, "sibling").flatMap((sibling) =>
        related(index, sibling, "spouse").map((siblingInLaw) => ({
          personId: siblingInLaw,
          viaIds: [sibling],
          reason: `${theirs(name(sibling), "sibling")}, and ${name(siblingInLaw)} is ${name(sibling)}'s partner.`,
        })),
      ),
    ],
  },
  {
    role: "stepparent",
    // A parent's partner who is not already recorded as your parent. Ranked
    // last because it is the one inference that is as often a second parent
    // you simply had not linked yet — which is why it stays a suggestion.
    run: (index, subject, name) => {
      const parents = new Set(related(index, subject, "parent"));
      return [...parents].flatMap((parent) =>
        related(index, parent, "spouse")
          .filter((partner) => !parents.has(partner) && partner !== subject)
          .map((partner) => ({
            personId: partner,
            viaIds: [parent],
            reason: `${theirs(name(parent), "parent")}, and ${name(partner)} is ${name(parent)}'s partner — a stepparent, unless they are a parent you have not linked yet.`,
          })),
      );
    },
  },
  {
    role: "cousin",
    run: (index, subject, name) => [
      // Recorded aunt/uncle → their children.
      ...related(index, subject, "aunt-uncle").flatMap((auntUncle) =>
        related(index, auntUncle, "child").map((cousin) => ({
          personId: cousin,
          viaIds: [auntUncle],
          reason: `${theirs(name(auntUncle), "aunt or uncle")}, and ${name(cousin)} is ${name(auntUncle)}'s child.`,
        })),
      ),
      // The long way round, when the aunt/uncle link itself is not recorded.
      ...related(index, subject, "parent").flatMap((parent) =>
        related(index, parent, "sibling").flatMap((auntUncle) =>
          related(index, auntUncle, "child").map((cousin) => ({
            personId: cousin,
            viaIds: [parent, auntUncle],
            reason: `${theirs(name(parent), "parent")}, ${name(auntUncle)} is ${name(parent)}'s sibling, and ${name(cousin)} is ${name(auntUncle)}'s child.`,
          })),
        ),
      ),
    ],
  },
];

// `aunt-uncle` is read by the cousin rule but is not a path role, so it is not
// in TRAVERSABLE. Guard the two lists against drifting apart.
const READ_ROLES: FamilyRole[] = [...TRAVERSABLE, "aunt-uncle"];

export function suggestFamilyLinks(input: SuggestInput): FamilySuggestion[] {
  const usable = input.edges.filter((edge) => READ_ROLES.includes(edge.role));
  const index = buildIndex(usable);
  const name = (id: string) => input.names.get(id) ?? "Someone";

  const subjects = input.subjectIds ?? [...index.keys()];
  const out: FamilySuggestion[] = [];
  /** Pairs already suggested, so the earliest (most confident) rule wins. */
  const claimed = new Set<string>();

  for (const subject of subjects) {
    for (const rule of RULES) {
      for (const hit of rule.run(index, subject, name)) {
        if (hit.personId === subject) continue;
        const key = pairKey(subject, hit.personId);
        if (input.linked.has(key) || claimed.has(key)) continue;
        claimed.add(key);
        out.push({
          subjectId: subject,
          personId: hit.personId,
          role: rule.role,
          reason: hit.reason,
          viaIds: hit.viaIds,
        });
      }
    }
  }

  return out;
}
