import "server-only";
import { prisma } from "@/server/db/client";
import {
  associatePrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
} from "@/server/privacy/filter";
import { applyCap, type CappedList } from "@/lib/list-cap";
import { displayName } from "@/lib/utils";

/**
 * The roll-up of everyone noted as being in someone else's life.
 *
 * Its own module rather than an entry in `detailInclude`, because this read
 * starts from the entry rather than from one person: the include is scoped to
 * a single contact by construction and cannot answer "show me all of them".
 *
 * Two fragments, always, and neither is optional. An entry carries its own
 * marker *and* hangs off a person who may be private, and either one alone
 * lets the other's rows through.
 */

export interface AssociateEntry {
  id: string;
  name: string;
  howTheyKnow: string | null;
  notes: string | null;
  isPrivate: boolean;
  /** Whether this entry became a tracked person — true even when the link below is withheld. */
  isPromoted: boolean;
  /** The person it became. Null when unpromoted, foreign, or private while locked. */
  promoted: { id: string; name: string } | null;
}

export interface AssociateGroup {
  contact: { id: string; name: string };
  entries: AssociateEntry[];
}

/**
 * One entry, with the promotion link resolved.
 *
 * Keep in step with the matching pass in `getContact` — the two exist
 * separately because that one mutates a Prisma payload in place.
 */
function toEntry(
  row: {
    id: string;
    name: string;
    howTheyKnow: string | null;
    notes: string | null;
    isPrivate: boolean;
    promotedContactId: string | null;
    promoted: {
      id: string;
      ownerId: string;
      firstName: string;
      lastName: string | null;
      isPrivate: boolean;
    } | null;
  },
  ownerId: string,
): AssociateEntry {
  // Privacy is settled in the query by `associatePrivacyWhere`; what is left
  // here is the owner check, which the single-column promotion key cannot make
  // for itself.
  const foreign = row.promoted !== null && row.promoted.ownerId !== ownerId;
  return {
    id: row.id,
    name: row.name,
    howTheyKnow: row.howTheyKnow,
    notes: row.notes,
    isPrivate: row.isPrivate,
    isPromoted: row.promotedContactId !== null,
    promoted:
      row.promoted && !foreign
        ? { id: row.promoted.id, name: displayName(row.promoted) }
        : null,
  };
}

/**
 * Every entry in the account, grouped by the person whose life they are in.
 *
 * The cap is applied to rows *before* grouping, so a truncated page never
 * shows one person with entries silently missing while the next reads whole.
 */
export async function listAssociateGroups(
  ownerId: string,
  cap = 300,
): Promise<CappedList<AssociateGroup>> {
  const scope = await privacyScope();
  const rows = await prisma.associate.findMany({
    where: {
      ownerId,
      ...associatePrivacyWhere(scope),
      ...viaContactPrivacyWhere(scope),
    },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      promoted: {
        select: {
          id: true,
          ownerId: true,
          firstName: true,
          lastName: true,
          isPrivate: true,
        },
      },
    },
    // Ordered through the contact so rows for one person arrive contiguous and
    // grouping is a single pass rather than a map keyed on id.
    //
    // `contactId` breaks the tie before any entry-level field, and it is not
    // cosmetic: two people can share a first and last name, and without it
    // their rows interleave. The grouping below only compares with the row
    // before it, so one person would then open several sections — rendered
    // with the same React key, and each holding part of their list.
    orderBy: [
      { contact: { firstName: "asc" } },
      { contact: { lastName: "asc" } },
      { contactId: "asc" },
      { name: "asc" },
      { id: "asc" },
    ],
    take: cap + 1,
  });

  const { items, truncated } = applyCap(rows, cap);

  const groups: AssociateGroup[] = [];
  for (const row of items) {
    const entry = toEntry(row, ownerId);
    const last = groups.at(-1);
    if (last && last.contact.id === row.contact.id) {
      last.entries.push(entry);
    } else {
      groups.push({
        contact: { id: row.contact.id, name: displayName(row.contact) },
        entries: [entry],
      });
    }
  }

  return { items: groups, truncated };
}
