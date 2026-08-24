import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import {
  endedRole,
  familyMeta,
  type FamilyRole,
  type FamilyTier,
  FAMILY_TIER_ORDER,
} from "@/lib/family";
import {
  pairKey,
  suggestFamilyLinks,
  type FamilyEdge,
  type FamilySuggestion,
} from "@/server/services/family-suggestions";
import { displayName } from "@/lib/utils";

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  avatarPath: true,
  isArchived: true,
  isPrivate: true,
  lastInteractionAt: true,
  nextTouchAt: true,
} satisfies Prisma.ContactSelect;

export type FamilyPerson = Prisma.ContactGetPayload<{ select: typeof PERSON_SELECT }>;

export interface FamilyLink {
  id: string;
  pairId: string;
  /** The person on the other end, from the subject's point of view. */
  person: FamilyPerson;
  term: { id: string; label: string; icon: string | null; color: string | null };
  tier: FamilyTier;
  generation: number;
  role: FamilyRole | null;
  notes: string | null;
  /** True when this link can be marked as ended — a marriage, in-law or step. */
  canEnd: boolean;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  notes: string | null;
  members: Array<{ person: FamilyPerson; role: string | null }>;
}

export interface SuggestionCard extends FamilySuggestion {
  subject: FamilyPerson;
  person: FamilyPerson;
  /** The taxonomy term the suggested role maps to, if the user still has it. */
  termId: string | null;
  termLabel: string | null;
}

/**
 * Every family relationship the current viewer is allowed to see.
 *
 * Relationships are stored in both directions, so reading only `relationsFrom`
 * gives each link once per endpoint — exactly what both the grouped section and
 * the tree want.
 */
async function loadFamilyEdges(ownerId: string) {
  const scope = await privacyScope();
  const visible = contactPrivacyWhere(scope);

  const rows = await prisma.relationship.findMany({
    where: {
      ownerId,
      type: { kind: "RELATIONSHIP_TYPE" },
      // A private person must not surface through someone else's family list.
      fromContact: visible,
      toContact: visible,
    },
    select: {
      id: true,
      pairId: true,
      notes: true,
      fromContactId: true,
      type: { select: { id: true, label: true, icon: true, color: true, metadata: true } },
      toContact: { select: PERSON_SELECT },
    },
  });

  return rows.filter((row) => familyMeta(row.type) !== null);
}

type FamilyRow = Awaited<ReturnType<typeof loadFamilyEdges>>[number];

function toLink(row: FamilyRow): FamilyLink {
  // Non-null by construction: loadFamilyEdges drops rows without family metadata.
  const meta = familyMeta(row.type)!;
  return {
    id: row.id,
    pairId: row.pairId,
    person: row.toContact,
    term: { id: row.type.id, label: row.type.label, icon: row.type.icon, color: row.type.color },
    tier: meta.tier,
    generation: meta.generation,
    role: meta.role,
    notes: row.notes,
    canEnd: endedRole(meta.role) !== null,
  };
}

/**
 * Pairs the suggester must leave alone: everyone already related in any way,
 * plus every pair you have explicitly dismissed.
 */
async function loadLinkedPairs(ownerId: string): Promise<Set<string>> {
  const [relationships, dismissals] = await Promise.all([
    prisma.relationship.findMany({
      where: { ownerId },
      select: { fromContactId: true, toContactId: true },
    }),
    prisma.familySuggestionDismissal.findMany({
      where: { ownerId },
      select: { aContactId: true, bContactId: true },
    }),
  ]);

  const out = new Set(relationships.map((row) => pairKey(row.fromContactId, row.toContactId)));
  for (const row of dismissals) out.add(pairKey(row.aContactId, row.bContactId));
  return out;
}

async function loadSuggestions(
  ownerId: string,
  rows: FamilyRow[],
  linked: Set<string>,
  subjectIds?: string[],
): Promise<SuggestionCard[]> {
  const edges: FamilyEdge[] = [];
  const people = new Map<string, FamilyPerson>();
  const names = new Map<string, string>();

  for (const row of rows) {
    const meta = familyMeta(row.type)!;
    if (meta.role) edges.push({ fromId: row.fromContactId, toId: row.toContact.id, role: meta.role });
    people.set(row.toContact.id, row.toContact);
    names.set(row.toContact.id, displayName(row.toContact));
  }

  const suggestions = suggestFamilyLinks({ edges, names, linked, subjectIds });
  if (suggestions.length === 0) return [];

  // Subjects can be people who only ever appear on the `from` side.
  const missing = suggestions
    .map((s) => s.subjectId)
    .filter((id) => !people.has(id));
  if (missing.length > 0) {
    const scope = await privacyScope();
    const extra = await prisma.contact.findMany({
      where: { ownerId, id: { in: missing }, ...contactPrivacyWhere(scope) },
      select: PERSON_SELECT,
    });
    for (const person of extra) people.set(person.id, person);
  }

  const terms = await prisma.taxonomyTerm.findMany({
    where: { ownerId, kind: "RELATIONSHIP_TYPE", isActive: true },
    select: { id: true, label: true, metadata: true },
  });
  const byRole = new Map<string, { id: string; label: string }>();
  for (const term of terms) {
    const role = familyMeta(term)?.role;
    if (role && !byRole.has(role)) byRole.set(role, { id: term.id, label: term.label });
  }

  return suggestions.flatMap((suggestion) => {
    const subject = people.get(suggestion.subjectId);
    const person = people.get(suggestion.personId);
    // A suggestion whose endpoint the viewer cannot see is not shown at all —
    // "we think you're related to someone" is still a leak.
    if (!subject || !person) return [];
    const term = byRole.get(suggestion.role) ?? null;
    return [{ ...suggestion, subject, person, termId: term?.id ?? null, termLabel: term?.label ?? null }];
  });
}

export interface ContactFamily {
  /** Family links grouped by tier, in display order. Empty tiers are dropped. */
  tiers: Array<{ tier: FamilyTier; links: FamilyLink[] }>;
  households: HouseholdSummary[];
  suggestions: SuggestionCard[];
}

export const getContactFamily = cache(
  async (ownerId: string, contactId: string): Promise<ContactFamily> => {
    const [rows, linked, households] = await Promise.all([
      loadFamilyEdges(ownerId),
      loadLinkedPairs(ownerId),
      listHouseholdsFor(ownerId, contactId),
    ]);

    const mine = rows.filter((row) => row.fromContactId === contactId).map(toLink);
    const byTier = new Map<FamilyTier, FamilyLink[]>();
    for (const link of mine) {
      const list = byTier.get(link.tier);
      if (list) list.push(link);
      else byTier.set(link.tier, [link]);
    }

    const tiers = FAMILY_TIER_ORDER.flatMap((tier) => {
      const links = byTier.get(tier);
      if (!links || links.length === 0) return [];
      // Elders first within a tier, then alphabetically.
      links.sort(
        (a, b) =>
          b.generation - a.generation ||
          displayName(a.person).localeCompare(displayName(b.person)),
      );
      return [{ tier, links }];
    });

    return {
      tiers,
      households,
      suggestions: await loadSuggestions(ownerId, rows, linked, [contactId]),
    };
  },
);

async function listHouseholdsFor(ownerId: string, contactId: string): Promise<HouseholdSummary[]> {
  const scope = await privacyScope();
  const rows = await prisma.household.findMany({
    where: { ownerId, members: { some: { contactId } } },
    select: {
      id: true,
      name: true,
      notes: true,
      members: {
        where: { contact: contactPrivacyWhere(scope) },
        select: { role: true, contact: { select: PERSON_SELECT } },
        orderBy: [{ sortOrder: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    members: row.members.map((m) => ({ person: m.contact, role: m.role })),
  }));
}

export interface FamilyOverview {
  households: HouseholdSummary[];
  /** Everyone with at least one family link, banded by generation. */
  bands: Array<{ generation: number; people: FamilyTreePerson[] }>;
  suggestions: SuggestionCard[];
  /** Whose point of view the generations are measured from. */
  anchor: FamilyPerson | null;
}

export interface FamilyTreePerson {
  person: FamilyPerson;
  /** How they connect, phrased from the anchor's point of view. */
  links: FamilyLink[];
  householdNames: string[];
}

/**
 * The `/family` view.
 *
 * Generations are measured from an anchor: the person you pick, or — with no
 * anchor — whoever has the most family links, which in a personal CRM is
 * almost always the middle of the family you care about. Someone with no path
 * to the anchor still appears, banded at their own generation 0, rather than
 * being dropped for not fitting the shape.
 */
export const getFamilyOverview = cache(
  async (ownerId: string, anchorId?: string): Promise<FamilyOverview> => {
    const scope = await privacyScope();
    const [rows, linked, households] = await Promise.all([
      loadFamilyEdges(ownerId),
      loadLinkedPairs(ownerId),
      prisma.household.findMany({
        where: { ownerId },
        select: {
          id: true,
          name: true,
          notes: true,
          members: {
            where: { contact: contactPrivacyWhere(scope) },
            select: { role: true, contact: { select: PERSON_SELECT } },
            orderBy: [{ sortOrder: "asc" }],
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const degree = new Map<string, number>();
    for (const row of rows) {
      degree.set(row.fromContactId, (degree.get(row.fromContactId) ?? 0) + 1);
    }

    let anchor = anchorId;
    if (!anchor || !degree.has(anchor)) {
      anchor = [...degree.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    }

    const generations = anchor ? walkGenerations(rows, anchor) : new Map<string, number>();

    const householdNames = new Map<string, string[]>();
    for (const household of households) {
      for (const member of household.members) {
        const list = householdNames.get(member.contact.id);
        if (list) list.push(household.name);
        else householdNames.set(member.contact.id, [household.name]);
      }
    }

    const people = new Map<string, FamilyTreePerson>();
    for (const row of rows) {
      const self = row.toContact;
      if (!people.has(self.id)) {
        people.set(self.id, {
          person: self,
          links: [],
          householdNames: householdNames.get(self.id) ?? [],
        });
      }
    }
    // Links are attached from the anchor's perspective where one exists, so the
    // tree reads "Gran — their grandmother" rather than repeating every edge.
    for (const row of rows) {
      if (row.fromContactId !== anchor) continue;
      people.get(row.toContact.id)?.links.push(toLink(row));
    }

    const banded = new Map<number, FamilyTreePerson[]>();
    for (const [id, entry] of people) {
      const generation = generations.get(id) ?? 0;
      const list = banded.get(generation);
      if (list) list.push(entry);
      else banded.set(generation, [entry]);
    }

    const bands = [...banded.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([generation, list]) => ({
        generation,
        people: list.sort((a, b) =>
          displayName(a.person).localeCompare(displayName(b.person)),
        ),
      }));

    return {
      households: households.map((row) => ({
        id: row.id,
        name: row.name,
        notes: row.notes,
        members: row.members.map((m) => ({ person: m.contact, role: m.role })),
      })),
      bands,
      suggestions: await loadSuggestions(ownerId, rows, linked),
      anchor: anchor ? (people.get(anchor)?.person ?? null) : null,
    };
  },
);

/**
 * Breadth-first generation assignment from an anchor.
 *
 * Each edge carries its own generation delta, so "Gran is Mum's parent" lands
 * two bands above you without needing to know anything about family structure.
 * BFS means the shortest path wins, which keeps a cousin marriage or a
 * remarriage from dragging someone into a nonsensical band.
 */
function walkGenerations(rows: FamilyRow[], anchor: string): Map<string, number> {
  const out = new Map<string, number>([[anchor, 0]]);
  const adjacency = new Map<string, Array<{ to: string; delta: number }>>();
  for (const row of rows) {
    const meta = familyMeta(row.type)!;
    const list = adjacency.get(row.fromContactId);
    const edge = { to: row.toContact.id, delta: meta.generation };
    if (list) list.push(edge);
    else adjacency.set(row.fromContactId, [edge]);
  }

  const queue = [anchor];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const base = out.get(current)!;
    for (const edge of adjacency.get(current) ?? []) {
      if (out.has(edge.to)) continue;
      out.set(edge.to, base + edge.delta);
      queue.push(edge.to);
    }
  }
  return out;
}

/** Household names for the "add to a household" picker on a contact page. */
export async function listHouseholdOptions(
  ownerId: string,
): Promise<Array<{ id: string; name: string }>> {
  return prisma.household.findMany({
    where: { ownerId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
