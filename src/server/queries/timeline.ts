import "server-only";
import { prisma } from "@/server/db/client";
import {
  interactionPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/filter";
import { calendarDateInTz, plainDateFromDb, type PlainDate } from "@/lib/dates";
import { comparePartialDates, type DatePrecision } from "@/lib/date-precision";

/**
 * The unified timeline.
 *
 * Four different things share one feed: interactions (what you did together),
 * life events (what happened to them), important dates that have already come
 * round, and gifts that changed hands. They live in separate tables because
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

  // Each source is capped at `take` — after merging we slice again, so no
  // single source can crowd the others out of the window.
  const [interactions, lifeEvents, importantDates, gifts] = await Promise.all([
    kinds.has("interaction") ? fetchInteractions(ownerId, options, take, scope) : [],
    kinds.has("life-event") ? fetchLifeEvents(ownerId, options, take, scope) : [],
    kinds.has("important-date") ? fetchImportantDates(ownerId, options, take, scope) : [],
    kinds.has("gift") ? fetchGifts(ownerId, options, take, scope) : [],
  ]);

  const now = new Date();
  const today = calendarDateInTz(now, timezone);

  const entries: TimelineEntry[] = [
    ...interactions.map((row) => interactionEntry(row, timezone, now)),
    ...lifeEvents.map(lifeEventEntry),
    ...importantDates.map((row) => importantDateEntry(row, today)),
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
  return prisma.interaction.findMany({
    where: {
      ownerId,
      ...interactionPrivacyWhere(scope),
      ...contactFilter(options.contactId),
      ...(options.typeIds?.length ? { typeId: { in: options.typeIds } } : {}),
      ...(options.from || options.to
        ? { occurredAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: endOfDay(options.to) } : {}) } }
        : {}),
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
) {
  return prisma.lifeEvent.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      ...(options.contactId ? { contactId: options.contactId } : {}),
      ...(options.from || options.to
        ? { date: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
    },
    include: {
      type: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
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
) {
  return prisma.importantDate.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      ...(options.contactId ? { contactId: options.contactId } : {}),
      ...(options.from || options.to
        ? { date: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
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
) {
  return prisma.gift.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      // Only gifts that actually changed hands belong on a history feed.
      status: "GIVEN",
      occurredOn: {
        not: null,
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
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
    href: contacts[0] ? `/people/${contacts[0].id}` : "/timeline",
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
    contacts: [row.contact],
    href: `/people/${row.contactId}`,
  };
}

function importantDateEntry(row: ImportantDateRow, today: PlainDate): TimelineEntry {
  const date = plainDateFromDb(row.date);
  return {
    id: row.id,
    kind: "important-date",
    date,
    precision: row.precision,
    title: row.label,
    detail: row.notes,
    upcoming: date.year > today.year,
    term: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
    contacts: [row.contact],
    href: `/people/${row.contactId}`,
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
    href: `/people/${row.contactId}`,
  };
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}
