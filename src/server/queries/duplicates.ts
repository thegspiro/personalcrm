import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { isMailSlug } from "@/lib/contact-methods";
import { findDuplicatePairs, pairKey, type MatchKind } from "@/lib/duplicates";

/**
 * People who might be the same person, by a shared email address or phone
 * number and nothing else — see `src/lib/duplicates.ts` for why the rule is
 * that narrow.
 *
 * Privacy-filtered like every other read: a private contact is not offered as a
 * duplicate of a public one while the lock is closed, because the suggestion
 * would name them. The scan is over the contacts the reader can see, which is
 * the only set a merge could legitimately act on anyway.
 */

/**
 * How many contacts the scan reads.
 *
 * The grouping happens in memory — normalising a number is not something to ask
 * SQL to do consistently — so this is a real bound rather than a formality. It
 * is far above any personal address book, and the scan says when it bit.
 */
export const SCAN_CAP = 2000;

export interface DuplicateCandidate {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  avatarPath: string | null;
  isArchived: boolean;
  createdAt: Date;
  /** What the two records share, for the screen to say why they are here. */
  methodCount: number;
  interactionCount: number;
}

export interface DuplicateSuggestion {
  key: string;
  a: DuplicateCandidate;
  b: DuplicateCandidate;
  matches: Array<{ kind: MatchKind; value: string }>;
}

export interface DuplicateScan {
  suggestions: DuplicateSuggestion[];
  /** True when more contacts exist than the scan read. */
  truncated: boolean;
}

/**
 * The one place the shape of a scanned row is written down.
 *
 * Declared as a const rather than inline so the row type can be derived from it
 * instead of from a second, never-called query — which is what this was first,
 * and which is a real unbounded `findMany` sitting in the file waiting for
 * somebody to call it by mistake.
 */
const SCAN_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  avatarPath: true,
  isArchived: true,
  createdAt: true,
  methods: { select: { value: true, type: { select: { slug: true } } } },
  _count: { select: { participations: true } },
} satisfies Prisma.ContactSelect;

type Row = Prisma.ContactGetPayload<{ select: typeof SCAN_SELECT }>;

export async function scanForDuplicates(ownerId: string): Promise<DuplicateScan> {
  const scope = await privacyScope();
  const where = { ownerId, ...contactPrivacyWhere(scope) };

  const contacts = await prisma.contact.findMany({
    where,
    select: SCAN_SELECT,
    orderBy: { createdAt: "asc" },
    take: SCAN_CAP + 1,
  });

  const scanned = contacts.slice(0, SCAN_CAP);
  const byId = new Map(scanned.map((row) => [row.id, row]));

  const pairs = findDuplicatePairs(
    scanned.map((row) => ({
      contactId: row.id,
      methods: row.methods.map((method) => ({
        isEmail: isMailSlug(method.type?.slug),
        value: method.value,
      })),
    })),
  );

  // Dismissed pairs are dropped here rather than filtered in SQL: the pair is
  // only known after the grouping, and there are never many.
  const dismissals = await prisma.duplicateDismissal.findMany({
    where: { ownerId },
    select: { aContactId: true, bContactId: true },
  });
  const dismissed = new Set(
    dismissals.map((row) => pairKey(row.aContactId, row.bContactId)),
  );

  const suggestions: DuplicateSuggestion[] = [];
  for (const pair of pairs) {
    const key = pairKey(pair.aContactId, pair.bContactId);
    if (dismissed.has(key)) continue;

    const a = byId.get(pair.aContactId);
    const b = byId.get(pair.bContactId);
    if (!a || !b) continue;

    suggestions.push({
      key,
      a: toCandidate(a),
      b: toCandidate(b),
      matches: pair.matches,
    });
  }

  // Oldest pairs first, which puts the records somebody has had longest — and
  // is therefore most likely to have duplicated by importing again — at the top.
  suggestions.sort((x, y) => x.a.createdAt.getTime() - y.a.createdAt.getTime());

  return { suggestions, truncated: contacts.length > SCAN_CAP };
}

function toCandidate(row: Row): DuplicateCandidate {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nickname: row.nickname,
    avatarPath: row.avatarPath,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    methodCount: row.methods.length,
    interactionCount: row._count.participations,
  };
}

/**
 * The two records side by side, in full, for the review screen.
 *
 * Separate from the scan because the scan needs a name and a count for many
 * pairs while this needs every column for exactly one. Privacy-filtered on the
 * same terms: a pair you cannot both see is a pair you cannot merge.
 */
export async function getMergePair(
  ownerId: string,
  aContactId: string,
  bContactId: string,
): Promise<{ a: MergeSide; b: MergeSide } | null> {
  if (aContactId === bContactId) return null;
  const scope = await privacyScope();

  const rows = await prisma.contact.findMany({
    where: {
      ownerId,
      id: { in: [aContactId, bContactId] },
      ...contactPrivacyWhere(scope),
    },
    include: {
      category: { select: { label: true } },
      methods: { select: { value: true, label: true, type: { select: { slug: true, label: true } } } },
      _count: {
        select: {
          participations: true,
          facts: true,
          importantDates: true,
          gifts: true,
          addresses: true,
        },
      },
    },
  });

  const a = rows.find((row) => row.id === aContactId);
  const b = rows.find((row) => row.id === bContactId);
  if (!a || !b) return null;
  return { a, b };
}

export type MergeSide = Prisma.ContactGetPayload<{
  include: {
    category: { select: { label: true } };
    methods: { select: { value: true; label: true; type: { select: { slug: true; label: true } } } };
    _count: {
      select: {
        participations: true;
        facts: true;
        importantDates: true;
        gifts: true;
        addresses: true;
      };
    };
  };
}>;
