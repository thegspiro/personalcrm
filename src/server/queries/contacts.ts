import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

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

function buildWhere(ownerId: string, options: ContactListOptions): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { ownerId };

  const scope = options.scope ?? "active";
  if (scope === "active") where.isArchived = false;
  else if (scope === "archived") where.isArchived = true;

  if (options.categoryId) where.categoryId = options.categoryId;
  if (options.romanticOnly) where.isRomantic = true;
  if (options.favoritesOnly) where.isFavorite = true;
  if (options.tagSlug) where.tags = { some: { tag: { slug: options.tagSlug } } };
  if (options.overdueOnly) where.nextTouchAt = { lte: new Date() };

  const search = options.search?.trim();
  if (search) {
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
      { facts: { some: { content: { contains: search } } } },
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
  const where = buildWhere(ownerId, options);
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
  return prisma.contact.findMany({
    where: { ownerId, isArchived: false },
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
    include: { type: true },
    orderBy: [{ date: "desc" }],
  },
  ideas: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
  tasks: { orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }] },
  gifts: { include: { occasion: true }, orderBy: { createdAt: "desc" } },
  relationsFrom: {
    include: {
      type: true,
      toContact: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
    },
  },
  romanticProfile: { include: { stage: true, source: true } },
  flags: { orderBy: [{ kind: "asc" }, { severity: "desc" }] },
} satisfies Prisma.ContactInclude;

export type ContactDetail = Prisma.ContactGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export const getContact = cache(
  async (ownerId: string, id: string): Promise<ContactDetail | null> => {
    return prisma.contact.findFirst({ where: { id, ownerId }, include: DETAIL_INCLUDE });
  },
);

/** Interactions for one contact, newest first, including future-dated ones. */
export async function listContactInteractions(
  ownerId: string,
  contactId: string,
  take = 50,
) {
  return prisma.interaction.findMany({
    where: { ownerId, participants: { some: { contactId } } },
    include: {
      type: true,
      dateEntry: { include: { activityType: true } },
      participants: {
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
