import "server-only";
import { prisma } from "@/server/db/client";
import {
  contactPrivacyWhere,
  interactionPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
} from "@/server/privacy/filter";
import {
  type PlainDate,
  addPlainDays,
  calendarDateInTz,
  diffPlainDays,
  nextOccurrence,
  plainDateFromDb,
} from "@/lib/dates";
import { hasKnownYear, yearsSince, type DatePrecision } from "@/lib/date-precision";
import { fetchContactBirthdays, isBirthdayImportantDate } from "./birthdays";

export interface OverdueContact {
  id: string;
  firstName: string;
  lastName: string | null;
  avatarPath: string | null;
  cadenceDays: number | null;
  lastInteractionAt: Date | null;
  nextTouchAt: Date | null;
  daysOverdue: number;
}

/**
 * Who you're due to reach out to, most overdue first.
 *
 * Reads `nextTouchAt`, which `recomputeContactActivity` keeps honest — so
 * backfilling old history never quietly clears someone off this list.
 */
export async function getOverdueContacts(
  ownerId: string,
  timezone: string,
  limit = 8,
): Promise<OverdueContact[]> {
  const now = new Date();
  const today = calendarDateInTz(now, timezone);

  const privacy = await privacyScope();
  const rows = await prisma.contact.findMany({
    where: {
      ownerId,
      isArchived: false,
      cadenceDays: { not: null },
      nextTouchAt: { not: null, lte: now },
      ...contactPrivacyWhere(privacy),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarPath: true,
      cadenceDays: true,
      lastInteractionAt: true,
      nextTouchAt: true,
    },
    orderBy: { nextTouchAt: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    ...row,
    daysOverdue: row.nextTouchAt
      ? Math.max(0, -diffPlainDays(today, calendarDateInTz(row.nextTouchAt, timezone)))
      : 0,
  }));
}

export interface UpcomingDate {
  id: string;
  label: string;
  contact: { id: string; firstName: string; lastName: string | null };
  term: { label: string; icon: string | null; color: string | null } | null;
  /** The next time it comes round. */
  occursOn: PlainDate;
  daysAway: number;
  /** Which anniversary this will be, when the original year is known. */
  turning: number | null;
  precision: DatePrecision;
}

/**
 * Birthdays and anniversaries coming up.
 *
 * Recurrence is resolved in code rather than SQL: a yearly date stored as
 * 1991-06-05 has to be projected onto this year or next, which no index can do.
 * Year-precision dates are skipped — "she moved sometime in 2019" is history,
 * not something to be reminded about.
 */
export async function getUpcomingDates(
  ownerId: string,
  timezone: string,
  windowDays = 45,
  limit = 8,
): Promise<UpcomingDate[]> {
  const today = calendarDateInTz(new Date(), timezone);
  const horizon = addPlainDays(today, windowDays);

  const privacy = await privacyScope();
  const [rows, birthdays] = await Promise.all([
    prisma.importantDate.findMany({
      where: {
        ownerId,
        contact: { isArchived: false, ...(privacy.unlocked ? {} : { isPrivate: false }) },
      },
      include: {
        type: true,
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    fetchContactBirthdays(ownerId, privacy),
  ]);

  const upcoming: UpcomingDate[] = [];

  // Contact.birthDate is authoritative. Birthday-typed legacy rows remain in
  // storage for reminder compatibility, but are hidden when a canonical value
  // exists so an account never sees the same birthday twice.
  const canonicalContactIds = new Set(birthdays.map((birthday) => birthday.contactId));
  const sources = [
    ...birthdays,
    ...rows.filter(
      (row) => !(canonicalContactIds.has(row.contactId) && isBirthdayImportantDate(row)),
    ),
  ];

  for (const row of sources) {
    if (row.precision === "YEAR" || row.precision === "MONTH") continue;

    const anchor = "canonicalBirthday" in row ? row.date : plainDateFromDb(row.date);
    const occursOn = nextOccurrence(anchor, today, row.recurrence);
    if (!occursOn) continue;

    const daysAway = diffPlainDays(today, occursOn);
    if (daysAway < 0 || diffPlainDays(occursOn, horizon) < 0) continue;

    upcoming.push({
      id: row.id,
      label: row.label,
      contact: row.contact,
      term: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
      occursOn,
      daysAway,
      turning: hasKnownYear(row.precision) ? yearsSince(anchor, row.precision, occursOn) : null,
      precision: row.precision,
    });
  }

  return upcoming.sort((a, b) => a.daysAway - b.daysAway).slice(0, limit);
}

export async function getRecentInteractions(ownerId: string, limit = 8) {
  const privacy = await privacyScope();
  return prisma.interaction.findMany({
    where: { ownerId, occurredAt: { lte: new Date() }, ...interactionPrivacyWhere(privacy) },
    include: {
      type: true,
      participants: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}

export async function getUpcomingInteractions(ownerId: string, limit = 5) {
  const privacy = await privacyScope();
  return prisma.interaction.findMany({
    where: { ownerId, occurredAt: { gt: new Date() }, ...interactionPrivacyWhere(privacy) },
    include: {
      type: true,
      participants: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { occurredAt: "asc" },
    take: limit,
  });
}

export async function getOpenTasks(ownerId: string, limit = 8) {
  const privacy = await privacyScope();
  return prisma.task.findMany({
    where: { ownerId, completedAt: null, ...viaContactPrivacyWhere(privacy) },
    include: { contact: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    take: limit,
  });
}

export async function getOpenIdeas(ownerId: string, limit = 6) {
  const privacy = await privacyScope();
  return prisma.idea.findMany({
    where: { ownerId, status: "OPEN", ...viaContactPrivacyWhere(privacy) },
    include: { contact: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export interface DashboardStats {
  people: number;
  interactionsThisMonth: number;
  interactionsTotal: number;
  overdue: number;
  openTasks: number;
  openIdeas: number;
}

export async function getStats(ownerId: string, timezone: string): Promise<DashboardStats> {
  const now = new Date();
  const today = calendarDateInTz(now, timezone);
  const monthStart = new Date(Date.UTC(today.year, today.month - 1, 1));

  const privacy = await privacyScope();
  const contactPrivacy = contactPrivacyWhere(privacy);
  const interactionPrivacy = interactionPrivacyWhere(privacy);

  // Counts are filtered too: a total that shifts when you unlock is itself a
  // disclosure that something is hidden.
  const [people, interactionsThisMonth, interactionsTotal, overdue, openTasks, openIdeas] =
    await Promise.all([
      prisma.contact.count({ where: { ownerId, isArchived: false, ...contactPrivacy } }),
      prisma.interaction.count({
        where: { ownerId, occurredAt: { gte: monthStart, lte: now }, ...interactionPrivacy },
      }),
      prisma.interaction.count({ where: { ownerId, occurredAt: { lte: now }, ...interactionPrivacy } }),
      prisma.contact.count({
        where: {
          ownerId,
          isArchived: false,
          cadenceDays: { not: null },
          nextTouchAt: { lte: now },
          ...contactPrivacy,
        },
      }),
      prisma.task.count({ where: { ownerId, completedAt: null, ...viaContactPrivacyWhere(privacy) } }),
      prisma.idea.count({ where: { ownerId, status: "OPEN", ...viaContactPrivacyWhere(privacy) } }),
    ]);

  return { people, interactionsThisMonth, interactionsTotal, overdue, openTasks, openIdeas };
}
