import "server-only";
import type { AssociateNoteKind, DatePrecision } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  associateNotePrivacyWhere,
  associatePrivacyWhere,
  contactPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/filter";
import { applyCap, type CappedList } from "@/lib/list-cap";
import { plainDateFromDb, type PlainDate } from "@/lib/dates";
import { displayName } from "@/lib/utils";

/**
 * Reads for the people in your contacts' lives.
 *
 * Every read here applies the same three fragments, and none is optional:
 * `associatePrivacyWhere` on the associate (its own marker, the person it was
 * promoted into, and whether anyone visible links to it), `viaContactPrivacyWhere`
 * on each link (so a private friend is never named as knowing them), and
 * `associateNotePrivacyWhere` on each note (so a private friend is never
 * named as a source, nor what they said shown). Any one alone lets the
 * others' rows through.
 */

interface PersonRef {
  id: string;
  name: string;
}

export interface AssociateNoteView {
  id: string;
  kind: AssociateNoteKind;
  content: string;
  /** Set on an update. */
  date: PlainDate | null;
  precision: DatePrecision;
  /** Who told you. Null when you heard it from them directly, or no longer know. */
  heardFrom: PersonRef | null;
  /** The logged conversation it came up in, when it was noted while logging one. */
  fromConversation: { label: string } | null;
}

export interface AssociateLinkView {
  contact: PersonRef;
  howTheyKnow: string | null;
}

/** The fields every view of an associate shares. */
interface AssociateBase {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Whether this entry became a tracked person — true even when the link below is withheld. */
  isPromoted: boolean;
  /** The person it became. Null when unpromoted, foreign, or private while locked. */
  promoted: PersonRef | null;
}

type PromotedRow = {
  id: string;
  ownerId: string;
  firstName: string;
  lastName: string | null;
} | null;

const PROMOTED_SELECT = {
  select: { id: true, ownerId: true, firstName: true, lastName: true },
} as const;

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * The shared fields, with the promotion link resolved.
 *
 * Privacy is settled in the query by `associatePrivacyWhere`; what is left
 * here is the owner check, which the single-column promotion key cannot make
 * for itself — an import or a hand repair can point it at another account.
 */
function toBase(
  row: {
    id: string;
    name: string;
    isPrivate: boolean;
    promotedContactId: string | null;
    promoted: PromotedRow;
  },
  ownerId: string,
): AssociateBase {
  const foreign = row.promoted !== null && row.promoted.ownerId !== ownerId;
  return {
    id: row.id,
    name: row.name,
    isPrivate: row.isPrivate,
    isPromoted: row.promotedContactId !== null,
    promoted:
      row.promoted && !foreign
        ? { id: row.promoted.id, name: displayName(row.promoted) }
        : null,
  };
}

/**
 * The conversation a note came from, with its owner: the key is single-column,
 * so a restore can point it at another account's row, and `toNote` drops one.
 */
const CONVERSATION_SELECT = {
  select: {
    ownerId: true,
    title: true,
    type: { select: { label: true } },
  },
} as const;

function noteInclude(scope: PrivacyScope) {
  return {
    where: associateNotePrivacyWhere(scope),
    include: { heardFrom: PERSON_SELECT, sourceInteraction: CONVERSATION_SELECT },
    // Details first, then updates newest first; `createdAt` and `id` settle
    // ties so the list does not reshuffle between renders.
    orderBy: [
      { kind: "asc" as const },
      { date: "desc" as const },
      { createdAt: "desc" as const },
      { id: "asc" as const },
    ],
  };
}

function toNote(
  row: {
    id: string;
    kind: AssociateNoteKind;
    content: string;
    date: Date | null;
    precision: DatePrecision;
    heardFrom: { id: string; firstName: string; lastName: string | null } | null;
    sourceInteraction: {
      ownerId: string;
      title: string | null;
      type: { label: string } | null;
    } | null;
  },
  ownerId: string,
): AssociateNoteView {
  const conversation =
    row.sourceInteraction && row.sourceInteraction.ownerId === ownerId
      ? row.sourceInteraction
      : null;
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    date: row.date ? plainDateFromDb(row.date) : null,
    precision: row.precision,
    heardFrom: row.heardFrom ? { id: row.heardFrom.id, name: displayName(row.heardFrom) } : null,
    fromConversation: conversation
      ? { label: conversation.title ?? conversation.type?.label ?? "a logged conversation" }
      : null,
  };
}

function linkInclude(scope: PrivacyScope) {
  return {
    where: viaContactPrivacyWhere(scope),
    include: { contact: PERSON_SELECT },
    orderBy: [{ createdAt: "asc" as const }, { contactId: "asc" as const }],
  };
}

// --- one contact's page ------------------------------------------------------

export interface ContactAssociate extends AssociateBase {
  /** How *this* contact knows them. */
  howTheyKnow: string | null;
  /** The other visible people whose lives they are in. */
  alsoKnownTo: PersonRef[];
  /** What this contact told you — safe to raise with them. */
  heardHere: AssociateNoteView[];
  /** What you heard any other way — shown muted, never offered as a prompt. */
  heardElsewhere: AssociateNoteView[];
}

/**
 * The associates in one contact's life, for the section on their page.
 *
 * The split between `heardHere` and `heardElsewhere` is the point of the
 * section: a note is only "heard here" when this contact is recorded as its
 * source. One heard from the associate directly is elsewhere too — the friend
 * may not know it either.
 */
export async function associatesForContact(
  ownerId: string,
  contactId: string,
): Promise<ContactAssociate[]> {
  const scope = await privacyScope();
  const links = await prisma.associateLink.findMany({
    where: {
      ownerId,
      contactId,
      ...viaContactPrivacyWhere(scope),
      associate: associatePrivacyWhere(scope),
    },
    include: {
      associate: {
        include: {
          promoted: PROMOTED_SELECT,
          links: linkInclude(scope),
          notes: noteInclude(scope),
        },
      },
    },
    orderBy: [{ associate: { name: "asc" } }, { associateId: "asc" }],
  });

  return links.map((link) => {
    const notes = link.associate.notes.map((note) => toNote(note, ownerId));
    return {
      ...toBase(link.associate, ownerId),
      howTheyKnow: link.howTheyKnow,
      alsoKnownTo: link.associate.links
        .filter((other) => other.contactId !== contactId)
        .map((other) => ({ id: other.contact.id, name: displayName(other.contact) })),
      heardHere: notes.filter((note) => note.heardFrom?.id === contactId),
      heardElsewhere: notes.filter((note) => note.heardFrom?.id !== contactId),
    };
  });
}

/**
 * Associates that could be linked into this contact's life instead of being
 * written down a second time: visible, not already linked here, and not yet
 * promoted — a promoted entry is a record, and the person it became is linked
 * through "Connected people" instead.
 */
export async function linkableAssociates(
  ownerId: string,
  contactId: string,
  cap = 300,
): Promise<CappedList<{ id: string; name: string; knownTo: string[] }>> {
  const scope = await privacyScope();
  const rows = await prisma.associate.findMany({
    where: {
      ownerId,
      promotedContactId: null,
      // ANDed rather than spread beside `links`: the fragment carries a
      // `links` key of its own while locked, and a second one in the same
      // object silently replaces it — which offered, by name, associates
      // known only through private contacts.
      AND: [associatePrivacyWhere(scope), { links: { none: { contactId } } }],
    },
    include: { links: linkInclude(scope) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: cap + 1,
  });
  const { items, truncated } = applyCap(rows, cap);
  return {
    items: items.map((row) => ({
      id: row.id,
      name: row.name,
      knownTo: row.links.map((link) => displayName(link.contact)),
    })),
    truncated,
  };
}

// --- the associate's own page ----------------------------------------------

export interface AssociateDetail extends AssociateBase {
  links: AssociateLinkView[];
  notes: AssociateNoteView[];
}

/** One associate, everything about them that the lock allows. */
export async function getAssociate(
  ownerId: string,
  id: string,
): Promise<AssociateDetail | null> {
  const scope = await privacyScope();
  const row = await prisma.associate.findFirst({
    where: { id, ownerId, ...associatePrivacyWhere(scope) },
    include: {
      promoted: PROMOTED_SELECT,
      links: linkInclude(scope),
      notes: noteInclude(scope),
    },
  });
  if (!row) return null;
  return {
    ...toBase(row, ownerId),
    links: row.links.map((link) => ({
      contact: { id: link.contact.id, name: displayName(link.contact) },
      howTheyKnow: link.howTheyKnow,
    })),
    notes: row.notes.map((note) => toNote(note, ownerId)),
  };
}

/**
 * Other associates this one could be the same person as.
 *
 * A promoted pair pointing at two different people is left out rather than
 * offered and refused: that is two tracked people, and folding them together
 * is a contact merge.
 */
export async function mergeCandidates(
  ownerId: string,
  associate: { id: string; promotedContactId: string | null },
  cap = 300,
): Promise<CappedList<{ id: string; name: string; knownTo: string[] }>> {
  const scope = await privacyScope();
  const rows = await prisma.associate.findMany({
    where: {
      ownerId,
      id: { not: associate.id },
      ...associatePrivacyWhere(scope),
      ...(associate.promotedContactId
        ? {
            AND: [
              {
                OR: [
                  { promotedContactId: null },
                  { promotedContactId: associate.promotedContactId },
                ],
              },
            ],
          }
        : {}),
    },
    include: { links: linkInclude(scope) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: cap + 1,
  });
  const { items, truncated } = applyCap(rows, cap);
  return {
    items: items.map((row) => ({
      id: row.id,
      name: row.name,
      knownTo: row.links.map((link) => displayName(link.contact)),
    })),
    truncated,
  };
}

/**
 * The contacts an associate could be linked to: visible, and not already
 * linked. Capped like every picker list.
 */
export async function linkableContacts(
  ownerId: string,
  associateId: string,
  cap = 500,
): Promise<CappedList<PersonRef>> {
  const scope = await privacyScope();
  const rows = await prisma.contact.findMany({
    where: {
      ownerId,
      isArchived: false,
      ...contactPrivacyWhere(scope),
      associateLinks: { none: { associateId } },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
    take: cap + 1,
  });
  const { items, truncated } = applyCap(rows, cap);
  return {
    items: items.map((row) => ({ id: row.id, name: displayName(row) })),
    truncated,
  };
}

// --- things to ask a friend about -----------------------------------------

export interface AskAboutItem {
  noteId: string;
  associate: PersonRef & {
    /** Their own page, or the profile they became once promoted. */
    href: string;
  };
  /** How this friend knows them, for "Dan (coworker)". */
  howTheyKnow: string | null;
  content: string;
  date: PlainDate | null;
  precision: DatePrecision;
}

export interface AskAbout {
  /** Newest first, at most the limit asked for. */
  items: AskAboutItem[];
  /** How many there are in all, under the same filters, for "See all". */
  total: number;
}

/**
 * What to ask one friend about: the news *they* told you about the people in
 * their life.
 *
 * Only updates, and only those whose source is this friend — a note heard
 * from anyone else, or from the associate directly, is exactly what must not
 * be raised with them. Only associates still in this friend's life: a
 * colleague removed from it is not someone to ask after.
 *
 * Newest first by the date the news was as of, so a backdated note sorts
 * where it belongs rather than by when it was typed. No staleness cut-off:
 * the date is shown, and whether a month-old update is still worth raising is
 * the reader's call.
 *
 * The associate's fragment and the link condition are ANDed, never spread
 * side by side: both carry a `links` key, and the second would replace the
 * first — the bug `linkableAssociates` had.
 */
export async function askAboutForContact(
  ownerId: string,
  contactId: string,
  limit = 3,
): Promise<AskAbout> {
  const scope = await privacyScope();
  const where = {
    ownerId,
    kind: "UPDATE" as const,
    heardFromContactId: contactId,
    ...associateNotePrivacyWhere(scope),
    associate: {
      AND: [associatePrivacyWhere(scope), { links: { some: { contactId } } }],
    },
  };
  const [rows, total] = await Promise.all([
    prisma.associateNote.findMany({
      where,
      include: {
        associate: {
          include: {
            promoted: PROMOTED_SELECT,
            links: { where: { contactId }, select: { howTheyKnow: true } },
          },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: limit,
    }),
    prisma.associateNote.count({ where }),
  ]);

  return {
    total,
    items: rows.map((row) => {
      const base = toBase(row.associate, ownerId);
      return {
        noteId: row.id,
        associate: {
          id: base.id,
          name: base.promoted?.name ?? base.name,
          href: base.promoted ? `/people/${base.promoted.id}` : `/people/friends/${base.id}`,
        },
        howTheyKnow: row.associate.links[0]?.howTheyKnow ?? null,
        content: row.content,
        date: row.date ? plainDateFromDb(row.date) : null,
        precision: row.precision,
      };
    }),
  };
}

/**
 * The same, for several friends at once — the plans list, where each planned
 * meetup with someone carries what to ask them.
 *
 * One query per friend rather than one for all: the limit is per friend, and
 * a single capped query would let one talkative friend's notes crowd out
 * everyone else's. The callers pass the distinct people on a capped list.
 */
export async function askAboutForContacts(
  ownerId: string,
  contactIds: string[],
  limit = 3,
): Promise<Map<string, AskAbout>> {
  const unique = [...new Set(contactIds)];
  const results = await Promise.all(
    unique.map((id) => askAboutForContact(ownerId, id, limit)),
  );
  return new Map(unique.map((id, index) => [id, results[index]!]));
}

// --- the roll-up ------------------------------------------------------------

export interface AssociateEntry extends AssociateBase {
  howTheyKnow: string | null;
  /** How many notes you hold about them, under the same lock as the notes. */
  noteCount: number;
}

export interface AssociateGroup {
  contact: PersonRef;
  entries: AssociateEntry[];
}

/**
 * Every link in the account, grouped by the person whose life they are in.
 *
 * An associate shared between two friends appears under each, because the
 * roll-up answers "who is in Alice's life", and Bob is in hers and Carol's.
 *
 * The cap is applied to rows *before* grouping, so a truncated page never
 * shows one person with entries silently missing while the next reads whole.
 */
export async function listAssociateGroups(
  ownerId: string,
  cap = 300,
): Promise<CappedList<AssociateGroup>> {
  const scope = await privacyScope();
  const rows = await prisma.associateLink.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      associate: associatePrivacyWhere(scope),
    },
    include: {
      contact: PERSON_SELECT,
      associate: {
        include: {
          promoted: PROMOTED_SELECT,
          _count: { select: { notes: { where: associateNotePrivacyWhere(scope) } } },
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
      { associate: { name: "asc" } },
      { associateId: "asc" },
    ],
    take: cap + 1,
  });

  const { items, truncated } = applyCap(rows, cap);

  const groups: AssociateGroup[] = [];
  for (const row of items) {
    const entry: AssociateEntry = {
      ...toBase(row.associate, ownerId),
      howTheyKnow: row.howTheyKnow,
      noteCount: row.associate._count.notes,
    };
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
