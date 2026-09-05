import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { addPlainDays, calendarDateInTz, zonedStartOfDay } from "@/lib/dates";
import { prisma } from "@/server/db/client";
import {
  RECIPROCITY_WINDOW,
  summarizeReciprocity,
  type ReciprocitySummary,
} from "@/lib/reciprocity";
import { DUE_SOON_DAYS } from "@/lib/cadence";
import {
  acquaintancePrivacyWhere,
  contactPrivacyWhere,
  factPrivacyWhere,
  interactionPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";

export type ContactSort = "name" | "recent" | "overdue" | "added";
export type ContactDueStatus = "actionable" | "soon";

export interface ContactListOptions {
  search?: string;
  categoryId?: string;
  tagId?: string;
  /** "all" includes archived; the default hides them. */
  scope?: "active" | "archived" | "all";
  romanticOnly?: boolean;
  favoritesOnly?: boolean;
  /**
   * "actionable" is everyone due through the end of today; "soon" widens that
   * to the same horizon the dashboard widget reaches, so following the widget
   * through lands on the list it was showing.
   */
  dueStatus?: ContactDueStatus;
  sort?: ContactSort;
  take?: number;
  skip?: number;
}

const LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  avatarPath: true,
  city: true,
  occupation: true,
  isFavorite: true,
  isArchived: true,
  isRomantic: true,
  cadenceDays: true,
  lastInteractionAt: true,
  nextTouchAt: true,
  createdAt: true,
  category: { select: { id: true, label: true, icon: true, color: true } },
} satisfies Prisma.ContactSelect;

export type ContactListItem = Prisma.ContactGetPayload<{
  select: typeof LIST_SELECT;
}>;

function buildWhere(
  ownerId: string,
  options: ContactListOptions,
  privacy: PrivacyScope,
  timezone: string,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {
    ownerId,
    ...contactPrivacyWhere(privacy),
  };

  const archiveScope = options.scope ?? "active";
  if (archiveScope === "active") where.isArchived = false;
  else if (archiveScope === "archived") where.isArchived = true;

  if (options.categoryId) where.categoryId = options.categoryId;
  if (options.tagId)
    where.tags = { some: { tag: { id: options.tagId, ownerId } } };
  if (options.romanticOnly) where.isRomantic = true;
  if (options.favoritesOnly) where.isFavorite = true;
  if (options.dueStatus) {
    // `cadenceStatus` calls the whole account-local due date overdue, so the
    // bound has to be the end of that day in the account timezone. A
    // millisecond offset from the server clock would drop someone due at 9pm
    // tonight and would land on the wrong instant across a DST change.
    const daysAhead = options.dueStatus === "soon" ? DUE_SOON_DAYS : 0;
    const today = calendarDateInTz(new Date(), timezone);
    const horizon = zonedStartOfDay(addPlainDays(today, daysAhead + 1), timezone);
    where.cadenceDays = { not: null };
    where.nextTouchAt = { not: null, lt: horizon };
  }

  const search = options.search?.trim();
  if (search) {
    const allergyCategory = (
      {
        food: "FOOD",
        medication: "MEDICATION",
        medicine: "MEDICATION",
        environmental: "ENVIRONMENTAL",
        environment: "ENVIRONMENTAL",
        other: "OTHER",
      } as Record<string, "FOOD" | "MEDICATION" | "ENVIRONMENTAL" | "OTHER">
    )[search.toLowerCase()];
    // Personal-scale data, so a LIKE across the obvious fields beats the
    // operational cost of maintaining a fulltext index.
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { nickname: { contains: search } },
      { occupation: { contains: search } },
      { employer: { contains: search } },
      { city: { contains: search } },
      { summary: { contains: search } },
      { methods: { some: { value: { contains: search } } } },
      // Search must not surface someone through a fact that is itself private.
      {
        facts: {
          some: { content: { contains: search }, ...factPrivacyWhere(privacy) },
        },
      },
      // Same rule as facts: a private entry must not surface the person it
      // belongs to, which would answer "is anything hidden here" from a page
      // the lock does not gate.
      {
        acquaintances: {
          some: { name: { contains: search }, ...acquaintancePrivacyWhere(privacy) },
        },
      },
      { dietaryNeeds: { some: { label: { contains: search } } } },
      { dietaryNeeds: { some: { reaction: { contains: search } } } },
      ...(allergyCategory
        ? [{ dietaryNeeds: { some: { category: allergyCategory } } }]
        : []),
    ];
  }

  return where;
}

function buildOrderBy(
  sort: ContactSort = "name",
): Prisma.ContactOrderByWithRelationInput[] {
  switch (sort) {
    case "recent":
      // Never-contacted people sort last rather than jumping to the top.
      return [
        { lastInteractionAt: { sort: "desc", nulls: "last" } },
        { firstName: "asc" },
      ];
    case "overdue":
      // Deliberately not pinning favourites here. This list means "who is most
      // overdue"; floating anyone above that answers a different question and
      // makes the one it was asked look wrong.
      return [
        { nextTouchAt: { sort: "asc", nulls: "last" } },
        { firstName: "asc" },
      ];
    case "added":
      return [{ createdAt: "desc" }];
    case "name":
    default:
      // The checkbox says favouriting pins someone near the top of your lists,
      // so the default sort has to actually do it.
      return [
        { isFavorite: "desc" },
        { firstName: "asc" },
        { lastName: "asc" },
      ];
  }
}

export async function listContacts(
  ownerId: string,
  options: ContactListOptions,
  timezone: string,
): Promise<{ items: ContactListItem[]; total: number }> {
  const privacy = await privacyScope();
  const where = buildWhere(ownerId, options, privacy, timezone);
  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: LIST_SELECT,
      orderBy: buildOrderBy(options.sort),
      take: options.take ?? 200,
      skip: options.skip ?? 0,
    }),
    prisma.contact.count({ where }),
  ]);
  return { items, total };
}

/**
 * How many people a picker draws before it stops.
 *
 * Exported so a caller that wants to *say* it ran out can over-fetch by one and
 * hand the result to `applyCap` — a full picker and a truncated one look
 * identical otherwise, and "they aren't in the list" reads as "I never added
 * them".
 */
export const CONTACT_OPTIONS_CAP = 500;

/** Lightweight list for pickers and the command palette. */
export const listContactOptions = cache(async (ownerId: string, take = CONTACT_OPTIONS_CAP) => {
  const scope = await privacyScope();
  return prisma.contact.findMany({
    where: { ownerId, isArchived: false, ...contactPrivacyWhere(scope) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      avatarPath: true,
    },
    orderBy: [
      { lastInteractionAt: { sort: "desc", nulls: "last" } },
      { firstName: "asc" },
    ],
    take,
  });
});

/**
 * Everything the profile page shows, for one owner.
 *
 * A function rather than a constant because the tag join needs the owner:
 * `ContactTag.contactId` and `Tag.id` are independent foreign keys with
 * nothing tying their owners together, so an import or a restore can join this
 * account's contact to another account's tag. Unfiltered, that tag's name was
 * rendered on the profile and its join id handed to the edit form — which
 * replaces every join on save, so the foreign association became this
 * account's to destroy.
 */
const detailInclude = (ownerId: string) =>
  ({
    category: true,
    tags: {
      where: { tag: { ownerId } },
      include: { tag: true },
      orderBy: { tag: { name: "asc" } },
    },
    meetingSource: true,
    methods: {
      include: { type: true },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    },
    // Ordered explicitly: without it the rows come back in whatever order the
    // database happens to return, so they reshuffle between renders.
    addresses: { orderBy: [{ label: "asc" }, { id: "asc" }] },
    facts: {
      include: { category: true },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    },
    // Ordered explicitly, like `addresses` above, for the same reason.
    acquaintances: {
      include: {
        // Selected with its owner: `promotedContactId` is the one key here
        // that is not same-owner, so the join can reach another account's
        // person after an import or a hand repair. `getContact` drops it.
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
      orderBy: [{ name: "asc" }, { id: "asc" }],
    },
    importantDates: { include: { type: true }, orderBy: { date: "asc" } },
    lifeEvents: {
      include: { type: true, participants: { include: { contact: true } } },
      orderBy: [{ date: "desc" }],
    },
    lifeEventParticipations: {
      include: {
        lifeEvent: {
          include: { type: true, participants: { include: { contact: true } } },
        },
      },
    },
    ideas: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
    tasks: { orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }] },
    gifts: { include: { occasion: true }, orderBy: { createdAt: "desc" } },
    debts: { orderBy: [{ settledOn: "asc" }, { incurredOn: "desc" }] },
    dietaryNeeds: { orderBy: { createdAt: "asc" } },
    relationsFrom: {
      include: {
        type: true,
        toContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarPath: true,
            isPrivate: true,
          },
        },
      },
    },
    romanticProfile: { include: { stage: true, source: true } },
    flags: { orderBy: [{ kind: "asc" }, { severity: "desc" }] },
  }) satisfies Prisma.ContactInclude;

export type ContactDetail = Prisma.ContactGetPayload<{
  include: ReturnType<typeof detailInclude>;
}>;

export const getContact = cache(
  async (ownerId: string, id: string): Promise<ContactDetail | null> => {
    const scope = await privacyScope();
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId, ...contactPrivacyWhere(scope) },
      include: detailInclude(ownerId),
    });
    if (!contact) return null;

    // Facts carry their own marker, so a single private note about an
    // otherwise ordinary person stays hidden.
    if (!scope.unlocked) {
      // The same rule as `lifeEventPrivacyWhere`, applied in memory because
      // detailInclude has already fetched the row: an event stays hidden when
      // any participant is private, not only when the anchor contact is.
      contact.lifeEvents = contact.lifeEvents.filter((event) =>
        event.participants.every(
          (participant) => !participant.contact.isPrivate,
        ),
      );
      contact.lifeEventParticipations = contact.lifeEventParticipations.filter(
        (participation) =>
          participation.lifeEvent.participants.every(
            (participant) => !participant.contact.isPrivate,
          ),
      );
      contact.facts = contact.facts.filter((fact) => !fact.isPrivate);
      // A relationship names the person on the other end, so a private
      // relative would otherwise be readable from an ordinary contact's page.
      contact.relationsFrom = contact.relationsFrom.filter(
        (relation) => !relation.toContact.isPrivate,
      );
      // detailInclude fetches the whole row, so a where-fragment elsewhere
      // would not help here: without this the private debt is serialised into
      // the page payload even though the section never renders it.
      contact.debts = contact.debts.filter((debt) => !debt.isPrivate);
      contact.acquaintances = contact.acquaintances
        .filter((entry) => !entry.isPrivate)
        // The promotion link names a real person, so a private one would be
        // readable from an ordinary contact's page — the same leak the
        // relationship filter above closes. The entry itself still shows, and
        // still reads as tracked: dropping that would make it editable again
        // and invite a second promotion.
        .map((entry) =>
          entry.promoted?.isPrivate ? { ...entry, promoted: null } : entry,
        );
    }

    // Unconditional, outside the lock block: the promotion pointer is reached
    // through the one key here that the database does not hold to a single
    // owner, so a foreign row is dropped for everybody, locked or not.
    contact.acquaintances = contact.acquaintances.map((entry) =>
      entry.promoted && entry.promoted.ownerId !== ownerId
        ? { ...entry, promoted: null }
        : entry,
    );
    return contact;
  },
);

/** Interactions for one contact, newest first, including future-dated ones. */
export async function listContactInteractions(
  ownerId: string,
  contactId: string,
  take = 50,
) {
  const scope = await privacyScope();
  return prisma.interaction.findMany({
    where: {
      ownerId,
      OR: [
        { participants: { some: { contactId } } },
        { mentions: { some: { contactId } } },
      ],
      ...interactionPrivacyWhere(scope),
    },
    include: {
      type: true,
      dateEntry: { include: { activityType: true } },
      participants: {
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      mentions: {
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

/**
 * How the reaching out has been split with one contact.
 *
 * Two queries rather than one: the window of attributed interactions the ratio
 * is built from, and the total logged, so the readout can say what share of the
 * history it actually speaks for. Both go through the same privacy scope — a
 * summary counting rows the list beside it does not show would quietly
 * disclose that something is hidden.
 */
export async function getReciprocity(
  ownerId: string,
  contactId: string,
  timezone: string,
): Promise<ReciprocitySummary> {
  const scope = await privacyScope();
  // `participants` is a key in both halves, so spreading the privacy fragment
  // into the same literal replaced the contact filter outright and summarised
  // every visible interaction in the account against this one person.
  const mine = {
    ownerId,
    AND: [
      { participants: { some: { contactId } } },
      interactionPrivacyWhere(scope),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.interaction.findMany({
      where: { ...mine, reachedOutBy: { not: "UNSPECIFIED" } },
      orderBy: { occurredAt: "desc" },
      take: RECIPROCITY_WINDOW,
      select: { reachedOutBy: true, occurredAt: true },
    }),
    prisma.interaction.count({ where: mine }),
  ]);

  return summarizeReciprocity(rows, total, timezone);
}
