import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  interactionPrivacyWhere,
  privacyScope,
  viaOptionalContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/filter";

/**
 * When a place may be seen at all.
 *
 * A place is only visible through something that happened there, so somewhere
 * known solely through hidden interactions is withheld entirely — listing it
 * with no visits would itself announce that someone you cannot show was there.
 *
 * One definition rather than three copies: the editing action needs exactly
 * this clause, and hand-copied predicates drift.
 *
 * Note the `AND`. `interactionPrivacyWhere` also keys on `participants`, so
 * spreading it beside another filter on the same key silently replaces that
 * filter — the bug that made every place look like one contact's in 6aeaa52.
 */
export function locationVisibleWhere(
  ownerId: string,
  scope: PrivacyScope,
): Prisma.LocationWhereInput {
  return {
    ownerId,
    AND: [
      {
        OR: [
          {
            interactions: {
              some: { ownerId, ...interactionPrivacyWhere(scope) },
            },
          },
          {
            plans: {
              some: { ownerId, ...viaOptionalContactPrivacyWhere(scope) },
            },
          },
        ],
      },
    ],
  };
}

export async function listLocations(ownerId: string, search?: string) {
  const scope = await privacyScope();
  const interactionWhere = { ownerId, ...interactionPrivacyWhere(scope) };
  const visible = locationVisibleWhere(ownerId, scope);
  const rows = await prisma.location.findMany({
    where: {
      ...visible,
      isArchived: false,
      AND: [
        ...(visible.AND as Prisma.LocationWhereInput[]),
        ...(search?.trim()
          ? [
              {
                OR: [
                  { name: { contains: search.trim() } },
                  { address: { contains: search.trim() } },
                  {
                    locationAliases: {
                      some: { ownerId, value: { contains: search.trim() } },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    include: {
      interactions: {
        where: interactionWhere,
        select: {
          occurredAt: true,
          sentiment: true,
          participants: { select: { contactId: true } },
        },
        orderBy: { occurredAt: "desc" },
      },
      plans: {
        where: { ownerId, ...viaOptionalContactPrivacyWhere(scope) },
        select: { id: true, status: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    ...row,
    visitCount: row.interactions.length,
    peopleCount: new Set(
      row.interactions.flatMap((item) =>
        item.participants.map((p) => p.contactId),
      ),
    ).size,
    lastVisitedAt: row.interactions[0]?.occurredAt ?? null,
    averageSentiment: average(
      row.interactions.flatMap((item) => item.sentiment ?? []),
    ),
    openPlanCount: row.plans.filter(
      (plan) => plan.status === "OPEN" || plan.status === "PLANNED",
    ).length,
  }));
}

/**
 * A lightweight list of places, for the quick-add parser.
 *
 * Privacy-filtered with the same predicate the Places directory uses: the set
 * of places you have been is itself a disclosure, so somewhere known only
 * through hidden interactions is not offered back while the lock is closed.
 *
 * The two halves are combined with `AND` rather than spread into one object.
 * `interactionPrivacyWhere` also keys on `participants`, so a spread silently
 * replaces a sibling filter — the bug fixed in `listContactLocations`.
 */
export async function listLocationOptions(ownerId: string) {
  const scope = await privacyScope();
  return prisma.location.findMany({
    where: { ...locationVisibleWhere(ownerId, scope), isArchived: false },
    select: {
      id: true,
      name: true,
      // Owner-filtered like every other read of this relation: the alias's
      // ownerId and its location's are two independent columns, so an import
      // or a restore can leave one account's alias hanging off another
      // account's place, and an unfiltered include hands its value straight to
      // quick-add matching.
      locationAliases: { where: { ownerId }, select: { value: true } },
    },
    // By name, not by recency: a "most recently visited" order derived from
    // unfiltered visits is a signal that shifts when the lock opens.
    //
    // Uncapped on purpose. A cap here is not a page, it is a silent hole in the
    // parser's vocabulary: past it, a known venue simply stops being recognised
    // and can have part of its name offered as a person instead. Two columns
    // for the places one person has actually been is a small read.
    orderBy: { name: "asc" },
  });
}

export async function getLocation(ownerId: string, id: string) {
  const scope = await privacyScope();
  const visibleInteraction = { ownerId, ...interactionPrivacyWhere(scope) };
  const visiblePlan = { ownerId, ...viaOptionalContactPrivacyWhere(scope) };
  return prisma.location.findFirst({
    // Deliberately not filtered on `isArchived`: an archived place keeps its
    // page and its history, it just leaves the directory.
    where: {
      id,
      ownerId,
      OR: [
        { interactions: { some: visibleInteraction } },
        { plans: { some: visiblePlan } },
      ],
    },
    include: {
      interactions: {
        where: visibleInteraction,
        include: {
          type: true,
          participants: {
            include: {
              contact: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { occurredAt: "desc" },
      },
      locationAliases: { where: { ownerId }, orderBy: { value: "asc" } },
      plans: {
        where: visiblePlan,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function listContactLocations(ownerId: string, contactId: string) {
  const scope = await privacyScope();
  // Both halves key on `participants` -- "this person was there" and "nobody
  // private was there" -- so spreading the privacy fragment into the same
  // object literal silently dropped the contact filter, and every place the
  // account had visited came back as this person's. AND keeps both.
  const theirs = {
    ownerId,
    AND: [
      { participants: { some: { contactId } } },
      interactionPrivacyWhere(scope),
    ],
  };
  const rows = await prisma.location.findMany({
    where: { ownerId, interactions: { some: theirs } },
    include: {
      interactions: {
        where: theirs,
        select: { occurredAt: true },
        orderBy: { occurredAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    visits: row.interactions.length,
    lastVisitedAt: row.interactions[0]?.occurredAt ?? null,
  }));
}

function average(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}
