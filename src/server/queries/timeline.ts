import "server-only";
import { prisma } from "@/server/db/client";
import {
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/filter";
import { calendarDateInTz, plainDateFromDb, type PlainDate } from "@/lib/dates";
import { comparePartialDates, overlapsRange, type DatePrecision } from "@/lib/date-precision";
import {
  fetchContactBirthdays,
  isBirthdayImportantDate,
  type BirthdayProjection,
} from "./birthdays";

/**
 * The unified timeline.
 *
 * This feed is deliberately historical. Four different things share it:
 * interactions (what you did together), life events (what happened to them),
 * one-time important dates that happened, and gifts that changed hands.
 * Recurring definitions are projected in the separate Coming up query; showing
 * their stored anchor here would pretend a reminder was a one-off event. They
 * live in separate tables because
 * they mean different things, so the merge happens here.
 *
 * Every entry carries a precision, because a backfilled life event may only be
 * known to the year. Sorting uses the *start* of the range a fuzzy date covers,
 * so "2019" sits with early 2019 rather than drifting to New Year's Eve.
 */
export type TimelineKind = "interaction" | "life-event" | "important-date" | "gift";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  date: PlainDate;
  precision: DatePrecision;
  /** Present for interactions, which happen at a time rather than on a day. */
  occurredAt?: Date;
  title: string;
  detail?: string | null;
  /** True when this hasn't happened yet — a planned dinner, say. */
  upcoming?: boolean;
  /**
   * Worth blurring alongside the other private notes. Set for dates, so the
   * same sentence is not blurred on the contact page and plain in the feed.
   */
  sensitive?: boolean;
  term?: { label: string; icon: string | null; color: string | null } | null;
  contacts: Array<{ id: string; firstName: string; lastName: string | null }>;
  sentiment?: number | null;
  reachedOutBy?: string | null;
  location?: string | null;
  href: string;
  editable?:
    | { kind: "important-date"; recurrence: "NONE" | "ANNUAL" | "MONTHLY"; typeId: string | null; notes: string | null; reminderDaysBefore: number[] | null }
    | { kind: "life-event"; typeId: string | null; description: string | null; endDate: PlainDate | null; endPrecision: DatePrecision | null; isMilestone: boolean }
    | { kind: "contact-birthday"; contactId: string };
}

export interface TimelineOptions {
  contactId?: string;
  kinds?: TimelineKind[];
  typeIds?: string[];
  /** Inclusive calendar bounds. */
  from?: Date;
  to?: Date;
  search?: string;
  take?: number;
}

const DEFAULT_TAKE = 60;

export async function buildTimeline(
  ownerId: string,
  timezone: string,
  options: TimelineOptions = {},
): Promise<TimelineEntry[]> {
  const take = options.take ?? DEFAULT_TAKE;
  const kinds = new Set<TimelineKind>(
    options.kinds && options.kinds.length > 0
      ? options.kinds
      : ["interaction", "life-event", "important-date", "gift"],
  );

  const scope = await privacyScope();
  const now = new Date();
  const today = calendarDateInTz(now, timezone);

  // Each source is capped at `take` — after merging we slice again, so no
  // single source can crowd the others out of the window.
  const [interactions, lifeEvents, importantDates, gifts, birthdays] = await Promise.all([
    kinds.has("interaction") ? fetchInteractions(ownerId, options, take, scope) : [],
    kinds.has("life-event") ? fetchLifeEvents(ownerId, options, take, scope, today) : [],
    kinds.has("important-date") ? fetchImportantDates(ownerId, options, take, scope, today) : [],
    kinds.has("gift") ? fetchGifts(ownerId, options, take, scope, today) : [],
    kinds.has("important-date")
      ? fetchContactBirthdays(ownerId, scope, { contactId: options.contactId, activeOnly: false })
      : [],
  ]);

  const entries: TimelineEntry[] = [
    ...interactions.map((row) => interactionEntry(row, timezone, now)),
    ...lifeEvents.map(lifeEventEntry),
    ...importantDates
      .filter(
        (row) =>
          !(
            birthdays.some((birthday) => birthday.contactId === row.contactId) &&
            isBirthdayImportantDate(row)
          ),
      )
      .map(importantDateEntry),
    ...birthdays
      .filter((birthday) =>
        overlapsRange(
          birthday.date,
          birthday.precision,
          options.from ? plainDateFromDb(options.from) : null,
          options.to ? plainDateFromDb(options.to) : null,
        ),
      )
      .map(birthdayTimelineEntry),
    ...gifts.map(giftEntry),
  ];

  const search = options.search?.trim().toLowerCase();
  const filtered = search
    ? entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(search) ||
          entry.detail?.toLowerCase().includes(search),
      )
    : entries;

  return filtered
    .sort((a, b) =>
      comparePartialDates(
        { date: a.date, precision: a.precision },
        { date: b.date, precision: b.precision },
      ),
    )
    .slice(0, take);
}

// --- sources ---------------------------------------------------------------

function contactFilter(contactId?: string) {
  return contactId ? { participants: { some: { contactId } } } : {};
}

async function fetchInteractions(
  ownerId: string,
  options: TimelineOptions,
  take: number,
  scope: PrivacyScope,
) {
  // Deliberately not clamped to today. Recurrence is what makes a feed
  // unboundedly future, and an interaction has none: a future-dated one is a
  // plan somebody recorded, and it is rendered with the "Upcoming" badge that
  // `upcoming` exists for. Hiding it here would put it nowhere at all -- the
  // Coming up view projects dates, not interactions.
  return prisma.interaction.findMany({
    where: {
      ownerId,
      ...(options.from || options.to
        ? {
            occurredAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: endOfDay(options.to) } : {}),
            },
          }
        : {}),
      ...interactionPrivacyWhere(scope),
      ...contactFilter(options.contactId),
      ...(options.typeIds?.length ? { typeId: { in: options.typeIds } } : {}),
    },
    include: {
      type: true,
      dateEntry: { select: { id: true } },
      participants: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

async function fetchLifeEvents(
  ownerId: string,
  options: TimelineOptions,
  take: number,
  scope: PrivacyScope,
  today: PlainDate,
) {
  const todayDb = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const historicalTo = options.to && options.to < todayDb ? options.to : todayDb;
  return prisma.lifeEvent.findMany({
    where: {
      ownerId,
      ...lifeEventPrivacyWhere(scope),
      ...(options.contactId ? { participants: { some: { contactId: options.contactId } } } : {}),
      date: { lte: historicalTo, ...(options.from ? { gte: options.from } : {}) },
    },
    include: {
      type: true,
      participants: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
    },
    orderBy: { date: "desc" },
    take,
  });
}

async function fetchImportantDates(
  ownerId: string,
  options: TimelineOptions,
  take: number,
  scope: PrivacyScope,
  today: PlainDate,
) {
  const todayDb = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const historicalTo = options.to && options.to < todayDb ? options.to : todayDb;
  return prisma.importantDate.findMany({
    where: {
      ownerId,
      recurrence: "NONE",
      ...viaContactPrivacyWhere(scope),
      ...(options.contactId ? { contactId: options.contactId } : {}),
      date: {
        lte: historicalTo,
        ...(options.from ? { gte: options.from } : {}),
      },
    },
    include: {
      type: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { date: "desc" },
    take,
  });
}

async function fetchGifts(
  ownerId: string,
  options: TimelineOptions,
  take: number,
  scope: PrivacyScope,
  today: PlainDate,
) {
  const todayDb = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const historicalTo = options.to && options.to < todayDb ? options.to : todayDb;
  return prisma.gift.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      // Only gifts that actually changed hands belong on a history feed.
      status: "GIVEN",
      occurredOn: {
        not: null,
        lte: historicalTo,
        ...(options.from ? { gte: options.from } : {}),
      },
      ...(options.contactId ? { contactId: options.contactId } : {}),
    },
    include: {
      occasion: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { occurredOn: "desc" },
    take,
  });
}

// --- mapping ---------------------------------------------------------------

type InteractionRow = Awaited<ReturnType<typeof fetchInteractions>>[number];
type LifeEventRow = Awaited<ReturnType<typeof fetchLifeEvents>>[number];
type ImportantDateRow = Awaited<ReturnType<typeof fetchImportantDates>>[number];
type GiftRow = Awaited<ReturnType<typeof fetchGifts>>[number];

function interactionEntry(row: InteractionRow, timezone: string, now: Date): TimelineEntry {
  const contacts = row.participants.map((p) => p.contact);
  return {
    id: row.id,
    kind: "interaction",
    date: calendarDateInTz(row.occurredAt, timezone),
    precision: "DAY",
    occurredAt: row.occurredAt,
    title: row.title ?? row.type?.label ?? "Interaction",
    detail: row.notes,
    upcoming: row.occurredAt > now,
    sensitive: row.dateEntry !== null,
    term: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
    contacts,
    sentiment: row.sentiment,
    reachedOutBy: row.reachedOutBy,
    location: row.location,
    href: contacts[0] ? `/people/${contacts[0].id}#timeline-entry-interaction-${row.id}` : "/timeline",
  };
}

function lifeEventEntry(row: LifeEventRow): TimelineEntry {
  return {
    id: row.id,
    kind: "life-event",
    date: plainDateFromDb(row.date),
    precision: row.precision,
    title: row.title,
    detail: row.description,
    term: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
    contacts: row.participants.map((participant) => participant.contact),
    href: row.participants[0] ? `/people/${row.participants[0].contactId}#life-event-${row.id}` : "/timeline",
    editable: { kind: "life-event", typeId: row.typeId, description: row.description,
      endDate: row.endDate ? plainDateFromDb(row.endDate) : null, endPrecision: row.endPrecision,
      isMilestone: row.isMilestone },
  };
}

function importantDateEntry(row: ImportantDateRow): TimelineEntry {
  const date = plainDateFromDb(row.date);
  return {
    id: row.id,
    kind: "important-date",
    date,
    precision: row.precision,
    title: row.label,
    detail: row.notes,
    term: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
    contacts: [row.contact],
    href: `/people/${row.contactId}#important-date-${row.id}`,
    // The reminder policy travels with the row because the edit form submits
    // every field it holds: leaving it out would reset a custom policy to the
    // account default on any unrelated correction made from the timeline.
    editable: {
      kind: "important-date",
      recurrence: row.recurrence,
      typeId: row.typeId,
      notes: row.notes,
      reminderDaysBefore: Array.isArray(row.reminderDaysBefore)
        ? (row.reminderDaysBefore as number[])
        : null,
    },
  };
}

/**
 * A timeline is history, so birthdays represent the original birth date, not
 * a moving next occurrence. Consequently they are never marked upcoming;
 * annual projection belongs to Coming up. MONTH_DAY retains its unknown-year
 * anchor and precision rather than inventing a birth year.
 */
function birthdayTimelineEntry(row: BirthdayProjection): TimelineEntry {
  return {
    id: row.id,
    kind: "important-date",
    date: row.date,
    precision: row.precision,
    title: row.label,
    detail: row.notes,
    upcoming: false,
    term: row.type,
    contacts: [row.contact],
    href: `/people/${row.contactId}#important-date-${row.id}`,
    editable: { kind: "contact-birthday", contactId: row.contactId },
  };
}

function giftEntry(row: GiftRow): TimelineEntry {
  return {
    id: row.id,
    kind: "gift",
    date: plainDateFromDb(row.occurredOn!),
    precision: "DAY",
    title: row.direction === "INCOMING" ? `Received: ${row.name}` : `Gave: ${row.name}`,
    detail: row.description,
    term: row.occasion
      ? { label: row.occasion.label, icon: row.occasion.icon, color: row.occasion.color }
      : { label: "Gift", icon: "Gift", color: "pink" },
    contacts: [row.contact],
    href: `/people/${row.contactId}#gift-${row.id}`,
  };
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}
