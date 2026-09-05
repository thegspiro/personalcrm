import "server-only";

import type { DatePrecision, Prisma } from "@prisma/client";
import {
  type PlainDate,
  addPlainDays,
  calendarDateInTz,
  diffPlainDays,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  projectDateOccurrences,
  zonedStartOfDay,
} from "@/lib/dates";
import { isWithin } from "@/lib/calendar-grid";
import { happeningSpan } from "@/lib/happenings";
import { prisma } from "@/server/db/client";
import { happeningDatesOf } from "@/server/services/happenings";
import {
  interactionPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  viaOptionalContactPrivacyWhere,
} from "@/server/privacy/filter";
import {
  fetchContactBirthdays,
  isBirthdayImportantDate,
  birthdayProjectionId,
} from "@/server/queries/birthdays";

/**
 * Everything dated, for one calendar window.
 *
 * Five sources, one `Promise.all`, all owner-scoped and all filtered in the
 * query rather than the component — invariant 3, and five sources means five
 * chances to forget it. The calendar inherits exactly the visibility rules the
 * pages these things already live on have, and adds none of its own: a plan
 * attached to a private contact is filtered by the lock, and a plan attached to
 * a romantic contact is not, because plans are deliberately not behind the lock.
 *
 * Nothing here reads the server clock. The window arrives as plain dates and
 * the only conversion to instants is the interaction bound, which is resolved
 * against the account's timezone — invariant 2.
 */

/** Which kind of dated thing an entry is, and what colour the UI gives it. */
export type CalendarKind = "plan" | "date" | "task" | "happening" | "interaction";

export interface CalendarEntry {
  id: string;
  kind: CalendarKind;
  /** The square it belongs in. */
  day: PlainDate;
  title: string;
  /** Where tapping it goes. The calendar shows things; it does not edit them. */
  href: string;
  contact: { id: string; firstName: string; lastName: string | null } | null;
  /** Local minutes past midnight, or null for something that has no time. */
  minute: number | null;
  /** A short qualifier — "done", "ongoing", "overdue" — or null. */
  note: string | null;
}

/**
 * Per-source caps.
 *
 * A month is small, but "everything dated" against an account with years of
 * history is not, and an unbounded five-way fan-out is how a page that felt
 * fine in testing falls over on real data. Each source is capped
 * independently so one busy kind cannot crowd out the others.
 */
const PER_SOURCE_CAP = 400;

/**
 * How far back a happening's stored anchor can sit from the days it covers.
 *
 * A YEAR-precision anchor means the whole year, so a trip that overlaps this
 * window may be stored with a date up to a year before it. The SQL bound is
 * only a prefilter; `happeningSpan` gives the real answer in memory. Copied
 * deliberately from `getHappeningsDigest`, which learned this the same way.
 */
const HAPPENING_REACH_BACK_DAYS = 366;

/** Only a real day belongs in a square. */
function hasKnownDay(precision: DatePrecision): boolean {
  return precision === "DAY" || precision === "MONTH_DAY";
}

export async function getCalendarEntries(
  ownerId: string,
  timezone: string,
  window: { from: PlainDate; to: PlainDate },
): Promise<CalendarEntry[]> {
  const scope = await privacyScope();

  // Interactions are the only source stored as an instant rather than a day, so
  // they are the only one whose bounds have to be resolved in a timezone. The
  // end is the start of the day *after* the window and the comparison is
  // exclusive, which is the one arrangement that does not depend on how many
  // hours the last day happens to have.
  const fromInstant = zonedStartOfDay(window.from, timezone);
  const toInstant = zonedStartOfDay(addPlainDays(window.to, 1), timezone);

  // A plan carries no privacy marker of its own; it inherits the one belonging
  // to the person it names, and a plan saved against nobody has no one to be
  // private. Written as an explicit AND rather than spread, because
  // `viaOptionalContactPrivacyWhere` emits an `OR` and a second `OR` key at the
  // same level silently replaces the first.
  const planClauses: Prisma.PlanWhereInput[] = [];
  if (!scope.unlocked) {
    planClauses.push({ OR: [{ contactId: null }, { contact: { isPrivate: false } }] });
  }

  const [planRows, importantRows, birthdays, taskRows, happeningRows, interactionRows] =
    await Promise.all([
      prisma.plan.findMany({
        where: {
          ownerId,
          plannedFor: { gte: plainDateToDb(window.from), lte: plainDateToDb(window.to) },
          ...(planClauses.length > 0 ? { AND: planClauses } : {}),
        },
        select: {
          id: true,
          title: true,
          status: true,
          plannedFor: true,
          plannedStartMinute: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { plannedFor: "asc" },
        take: PER_SOURCE_CAP,
      }),
      // Recurring dates cannot be bounded in SQL — the stored anchor is years
      // from the occurrence being asked about — so the row set is narrowed by
      // owner and privacy and the window is applied by the projection below.
      // The same shape `getUpcomingDates` uses.
      prisma.importantDate.findMany({
        where: {
          ownerId,
          contact: { isArchived: false },
          ...viaContactPrivacyWhere(scope),
        },
        select: {
          id: true,
          label: true,
          date: true,
          precision: true,
          recurrence: true,
          contactId: true,
          type: { select: { slug: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        take: PER_SOURCE_CAP,
      }),
      fetchContactBirthdays(ownerId, scope),
      prisma.task.findMany({
        where: {
          ownerId,
          dueDate: { gte: plainDateToDb(window.from), lte: plainDateToDb(window.to) },
          ...viaOptionalContactPrivacyWhere(scope),
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          completedAt: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { dueDate: "asc" },
        take: PER_SOURCE_CAP,
      }),
      prisma.happening.findMany({
        where: {
          ownerId,
          date: { lte: plainDateToDb(window.to) },
          OR: [
            { endDate: { gte: plainDateToDb(window.from) } },
            {
              endDate: null,
              date: { gte: plainDateToDb(addPlainDays(window.from, -HAPPENING_REACH_BACK_DAYS)) },
            },
          ],
          ...viaContactPrivacyWhere(scope),
        },
        select: {
          id: true,
          title: true,
          date: true,
          precision: true,
          endDate: true,
          endPrecision: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        take: PER_SOURCE_CAP,
      }),
      prisma.interaction.findMany({
        where: {
          ownerId,
          occurredAt: { gte: fromInstant, lt: toInstant },
          ...interactionPrivacyWhere(scope),
        },
        select: {
          id: true,
          title: true,
          occurredAt: true,
          participants: {
            select: { contact: { select: { id: true, firstName: true, lastName: true } } },
            take: 1,
          },
        },
        orderBy: { occurredAt: "asc" },
        take: PER_SOURCE_CAP,
      }),
    ]);

  const entries: CalendarEntry[] = [];

  for (const plan of planRows) {
    if (!plan.plannedFor) continue;
    entries.push({
      id: `plan:${plan.id}`,
      kind: "plan",
      day: plainDateFromDb(plan.plannedFor),
      title: plan.title,
      href: "/ideas",
      contact: plan.contact,
      minute: plan.plannedStartMinute,
      note: plan.status === "DONE" ? "done" : plan.status === "PLANNED" ? "planned" : null,
    });
  }

  // A contact with a canonical birthday also lends its reminder settings to a
  // legacy birthday-typed row that is deliberately kept in storage. Both would
  // land on the same square, so the row defers to the projection — the same
  // de-duplication `getUpcomingDates` does.
  const withCanonicalBirthday = new Set(birthdays.map((birthday) => birthday.contactId));

  const projected: Array<{
    id: string;
    label: string;
    anchor: PlainDate;
    precision: DatePrecision;
    recurrence: "NONE" | "ANNUAL" | "MONTHLY";
    contact: { id: string; firstName: string; lastName: string | null };
  }> = [];

  for (const row of importantRows) {
    if (isBirthdayImportantDate(row) && withCanonicalBirthday.has(row.contactId)) continue;
    projected.push({
      id: `date:${row.id}`,
      label: row.label,
      anchor: plainDateFromDb(row.date),
      precision: row.precision,
      recurrence: row.recurrence,
      contact: row.contact,
    });
  }
  for (const birthday of birthdays) {
    projected.push({
      id: birthdayProjectionId(birthday.contactId),
      label: birthday.label,
      anchor: birthday.date,
      precision: birthday.precision,
      recurrence: birthday.recurrence,
      contact: birthday.contact,
    });
  }

  for (const row of projected) {
    // Invariant 8: a partial date stays partial. "Sometime in 2019" has no
    // honest square, and `projectDateOccurrences` would answer with the first
    // day of the window — turning a vague memory into a confident-looking lie
    // on a specific Tuesday. Imprecise anchors are left off the grid entirely.
    if (!hasKnownDay(row.precision)) continue;

    // `today` is the window's own start, not the real today. The projection
    // clamps its lower bound to `today` so that asking for a historical range
    // cannot turn a past one-time date into an upcoming item — right for the
    // dashboard, wrong here, because a calendar showing March has to show
    // March's birthdays whether or not March has been and gone. The clamp is
    // defeated deliberately, and only for a window the user navigated to.
    for (const day of projectDateOccurrences(
      row.anchor,
      row.precision,
      row.recurrence,
      window.from,
      window,
    )) {
      entries.push({
        id: `${row.id}@${plainDateKey(day)}`,
        kind: "date",
        day,
        title: row.label,
        href: `/people/${row.contact.id}`,
        contact: row.contact,
        minute: null,
        note: null,
      });
    }
  }

  for (const task of taskRows) {
    if (!task.dueDate) continue;
    entries.push({
      id: `task:${task.id}`,
      kind: "task",
      day: plainDateFromDb(task.dueDate),
      title: task.title,
      href: "/tasks",
      contact: task.contact,
      minute: null,
      note: task.completedAt ? "done" : null,
    });
  }

  for (const happening of happeningRows) {
    const span = happeningSpan(happeningDatesOf(happening));
    // On every day it covers that the window shows, because that is what a trip
    // looks like on a calendar. The span is already widened to cover a vague
    // end, so this is the honest reading of "away from the 3rd to the 10th"
    // rather than a single marker on the 3rd.
    const first = diffPlainDays(window.from, span.start) >= 0 ? span.start : window.from;
    const last = diffPlainDays(span.end, window.to) >= 0 ? window.to : span.end;
    for (let day = first; diffPlainDays(day, last) >= 0; day = addPlainDays(day, 1)) {
      entries.push({
        id: `happening:${happening.id}@${plainDateKey(day)}`,
        kind: "happening",
        day,
        title: happening.title,
        href: `/people/${happening.contact.id}`,
        contact: happening.contact,
        minute: null,
        note: diffPlainDays(span.start, span.end) > 0 ? "ongoing" : null,
      });
    }
  }

  for (const interaction of interactionRows) {
    const day = calendarDateInTz(interaction.occurredAt, timezone);
    // Belt and braces: the SQL bound was resolved in this same timezone, so
    // this should never exclude anything. It costs nothing and it is the check
    // that would catch a bound computed against the wrong zone.
    if (!isWithin(day, window)) continue;
    const startOfDay = zonedStartOfDay(day, timezone);
    entries.push({
      id: `interaction:${interaction.id}`,
      kind: "interaction",
      day,
      title: interaction.title ?? "Caught up",
      href: "/timeline",
      contact: interaction.participants[0]?.contact ?? null,
      minute: Math.floor((interaction.occurredAt.getTime() - startOfDay.getTime()) / 60_000),
      note: null,
    });
  }

  // Within a day: timed things first in clock order, then the all-day ones
  // alphabetically, so the order is stable between renders rather than however
  // the five queries happened to come back.
  entries.sort((a, b) => {
    const byDate = diffPlainDays(b.day, a.day);
    if (byDate !== 0) return -byDate;
    if (a.minute !== b.minute) {
      if (a.minute === null) return 1;
      if (b.minute === null) return -1;
      return a.minute - b.minute;
    }
    return a.title.localeCompare(b.title);
  });

  return entries;
}
