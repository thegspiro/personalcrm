import "server-only";
import { prisma } from "@/server/db/client";
import {
  interactionPrivacyWhere,
  privacyScope,
  viaOptionalContactPrivacyWhere,
} from "@/server/privacy/filter";

export async function listLocations(ownerId: string, search?: string) {
  const scope = await privacyScope();
  const interactionWhere = { ownerId, ...interactionPrivacyWhere(scope) };
  const rows = await prisma.location.findMany({
    where: {
      ownerId,
      isArchived: false,
      AND: [
        ...(search?.trim()
          ? [{ OR: [{ name: { contains: search.trim() } }, { address: { contains: search.trim() } }] }]
          : []),
        { OR: [
          { interactions: { some: interactionWhere } },
          { plans: { some: { ownerId, ...viaOptionalContactPrivacyWhere(scope) } } },
        ] },
      ],
    },
    include: {
      interactions: {
        where: interactionWhere,
        select: { occurredAt: true, sentiment: true, participants: { select: { contactId: true } } },
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
    peopleCount: new Set(row.interactions.flatMap((item) => item.participants.map((p) => p.contactId))).size,
    lastVisitedAt: row.interactions[0]?.occurredAt ?? null,
    averageSentiment: average(row.interactions.flatMap((item) => item.sentiment ?? [])),
    openPlanCount: row.plans.filter((plan) => plan.status === "OPEN" || plan.status === "PLANNED").length,
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
    where: {
      ownerId,
      isArchived: false,
      AND: [
        { OR: [
          { interactions: { some: { ownerId, ...interactionPrivacyWhere(scope) } } },
          { plans: { some: { ownerId, ...viaOptionalContactPrivacyWhere(scope) } } },
        ] },
      ],
    },
    select: { id: true, name: true },
    // By name, not by recency: a "most recently visited" order derived from
    // unfiltered visits is a signal that shifts when the lock opens.
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function getLocation(ownerId: string, id: string) {
  const scope = await privacyScope();
  const visibleInteraction = { ownerId, ...interactionPrivacyWhere(scope) };
  const visiblePlan = { ownerId, ...viaOptionalContactPrivacyWhere(scope) };
  return prisma.location.findFirst({
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
          participants: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
        },
        orderBy: { occurredAt: "desc" },
      },
      plans: {
        where: visiblePlan,
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
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
    AND: [{ participants: { some: { contactId } } }, interactionPrivacyWhere(scope)],
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
  return rows.map((row) => ({ id: row.id, name: row.name, visits: row.interactions.length, lastVisitedAt: row.interactions[0]?.occurredAt ?? null }));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
