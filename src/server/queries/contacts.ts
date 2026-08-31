import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  RECIPROCITY_WINDOW,
  summarizeReciprocity,
  type ReciprocitySummary,
} from "@/lib/reciprocity";
import {
  contactPrivacyWhere,
  factPrivacyWhere,
  interactionPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";

export type ContactSort = "name" | "recent" | "overdue" | "added";

export interface ContactListOptions {
  search?: string;
  categoryId?: string;
  tagSlug?: string;
  /** "all" includes archived; the default hides them. */
  scope?: "active" | "archived" | "all";
  romanticOnly?: boolean;
  favoritesOnly?: boolean;
  overdueOnly?: boolean;
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
  tags: { select: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
} satisfies Prisma.ContactSelect;

export type ContactListItem = Prisma.ContactGetPayload<{ select: typeof LIST_SELECT }>;

function buildWhere(
  ownerId: string,
  options: ContactListOptions,
  privacy: PrivacyScope,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { ownerId, ...contactPrivacyWhere(privacy) };

  const archiveScope = options.scope ?? "active";
  if (archiveScope === "active") where.isArchived = false;
  else if (archiveScope === "archived") where.isArchived = true;

  if (options.categoryId) where.categoryId = options.categoryId;
  if (options.romanticOnly) where.isRomantic = true;
  if (options.favoritesOnly) where.isFavorite = true;
  if (options.tagSlug) where.tags = { some: { tag: { slug: options.tagSlug } } };
  if (options.overdueOnly) where.nextTouchAt = { lte: new Date() };

  const search = options.search?.trim();
  if (search) {
    const allergyCategory = ({
      food: "FOOD",
      medication: "MEDICATION",
      medicine: "MEDICATION",
      environmental: "ENVIRONMENTAL",
      environment: "ENVIRONMENTAL",
      other: "OTHER",
    } as Record<string, "FOOD" | "MEDICATION" | "ENVIRONMENTAL" | "OTHER">)[search.toLowerCase()];
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
      { facts: { some: { content: { contains: search }, ...factPrivacyWhere(privacy) } } },
      { dietaryNeeds: { some: { label: { contains: search } } } },
      { dietaryNeeds: { some: { reaction: { contains: search } } } },
      ...(allergyCategory ? [{ dietaryNeeds: { some: { category: allergyCategory } } }] : []),
    ];
  }

  return where;
}

function buildOrderBy(sort: ContactSort = "name"): Prisma.ContactOrderByWithRelationInput[] {
  switch (sort) {
    case "recent":
      // Never-contacted people sort last rather than jumping to the top.
      return [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { firstName: "asc" }];
    case "overdue":
      return [{ nextTouchAt: { sort: "asc", nulls: "last" } }, { firstName: "asc" }];
    case "added":
      return [{ createdAt: "desc" }];
    case "name":
    default:
      return [{ firstName: "asc" }, { lastName: "asc" }];
  }
}

export async function listContacts(
  ownerId: string,
  options: ContactListOptions = {},
): Promise<{ items: ContactListItem[]; total: number }> {
  const privacy = await privacyScope();
  const where = buildWhere(ownerId, options, privacy);
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

/** Lightweight list for pickers and the command palette. */
export const listContactOptions = cache(async (ownerId: string) => {
  const scope = await privacyScope();
  return prisma.contact.findMany({
    where: { ownerId, isArchived: false, ...contactPrivacyWhere(scope) },
    select: { id: true, firstName: true, lastName: true, nickname: true, avatarPath: true },
    orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { firstName: "asc" }],
    take: 500,
  });
});

const DETAIL_INCLUDE = {
  category: true,
  meetingSource: true,
  methods: { include: { type: true }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
  addresses: true,
  tags: { include: { tag: true } },
  facts: {
    include: { category: true },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
  },
  importantDates: { include: { type: true }, orderBy: { date: "asc" } },
  lifeEvents: {
    include: { type: true, participants: { include: { contact: true } } },
    orderBy: [{ date: "desc" }],
  },
  lifeEventParticipations: {
    include: {
      lifeEvent: { include: { type: true, participants: { include: { contact: true } } } },
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
        select: { id: true, firstName: true, lastName: true, avatarPath: true, isPrivate: true },
      },
    },
  },
  romanticProfile: { include: { stage: true, source: true } },
  flags: { orderBy: [{ kind: "asc" }, { severity: "desc" }] },
} satisfies Prisma.ContactInclude;

export type ContactDetail = Prisma.ContactGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export const getContact = cache(
  async (ownerId: string, id: string): Promise<ContactDetail | null> => {
    const scope = await privacyScope();
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId, ...contactPrivacyWhere(scope) },
      include: DETAIL_INCLUDE,
    });
    if (!contact) return null;

    // Facts carry their own marker, so a single private note about an
    // otherwise ordinary person stays hidden.
    if (!scope.unlocked) {
      contact.lifeEvents = contact.lifeEvents.filter(
        (event) => event.participants.every((participant) => !participant.contact.isPrivate),
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
      // DETAIL_INCLUDE fetches the whole row, so a where-fragment elsewhere
      // would not help here: without this the private debt is serialised into
      // the page payload even though the section never renders it.
      contact.debts = contact.debts.filter((debt) => !debt.isPrivate);
    }
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
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
      mentions: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

export async function listTags(ownerId: string) {
  return prisma.tag.findMany({
    where: { ownerId },
    select: { id: true, name: true, slug: true, color: true, _count: { select: { contacts: true } } },
    orderBy: { name: "asc" },
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
): Promise<ReciprocitySummary> {
  const scope = await privacyScope();
  // `participants` is a key in both halves, so spreading the privacy fragment
  // into the same literal replaced the contact filter outright and summarised
  // every visible interaction in the account against this one person.
  const mine = {
    ownerId,
    AND: [{ participants: { some: { contactId } } }, interactionPrivacyWhere(scope)],
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

  return summarizeReciprocity(rows, total);
}
