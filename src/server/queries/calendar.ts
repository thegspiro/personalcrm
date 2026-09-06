import "server-only";

import type { DatePrecision, Prisma } from "@prisma/client";
import {
  type PlainDate,
  addPlainDays,
  calendarDateInTz,
  clampToDbDate,
  diffPlainDays,
  plainDateFromDb,
  plainDateKey,
  plainDateToDb,
  projectDateOccurrences,
  zonedMinuteOfDay,
  zonedStartOfDay,
} from "@/lib/dates";
import { isWithin } from "@/lib/calendar-grid";
import { hasKnownYear } from "@/lib/date-precision";
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

/**
 * The widened lower bound the two vague-anchor prefilters share.
 *
 * Clamped, because the reach-back is this query's own doing and can walk off
 * the end of what MariaDB's `DATE` holds: the grid for January 1001 already
 * starts in December 1000, and another 366 days puts the bound in year 999,
 * which the server rejects outright. The month parser guards the grid, and it
 * cannot also be expected to know how far a prefilter it never sees reaches
 * back — so the widening clamps itself.
 */
function reachBackFrom(from: PlainDate): Date {
  return plainDateToDb(clampToDbDate(addPlainDays(from, -HAPPENING_REACH_BACK_DAYS)));
}

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
          // Only the two statuses `/ideas` actually lists. A `DONE` plan is
          // already on the calendar as the interaction `completePlan` wrote
          // from it — showing the plan too would double the same evening — and
          // an `ARCHIVED` one has been put away on purpose. Neither is
          // reachable from the link this entry carries, and an entry that goes
          // nowhere is worse than one that is not there.
          status: { in: ["OPEN", "PLANNED"] },
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
          // Merged into one `contact` object, not spread beside it: both
          // conditions want that key, and a second spread would silently
          // replace the first — dropping the archive filter entirely, and only
          // while the lock was closed.
          contact: { isArchived: false, ...(scope.unlocked ? {} : { isPrivate: false }) },
          // A one-off date cannot move, so it is bounded here like every other
          // dated row — widened by the same reach-back, because a `YEAR`
          // anchor sits up to a year before the day it means. Only the
          // recurring ones have to be fetched whole and narrowed by the
          // projection, which is what keeps the cap below off the rows that
          // could not have been in this window anyway.
          OR: [
            { recurrence: { not: "NONE" } },
            {
              recurrence: "NONE",
              date: {
                gte: reachBackFrom(window.from),
                lte: plainDateToDb(window.to),
              },
            },
          ],
        },
        orderBy: { date: "asc" },
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
          // Both bounds reach back, and the end one has to: an end recorded as
          // "in 2026" is stored as 1 January and only `happeningSpan` widens it
          // to 31 December, so comparing the stored anchor against the window
          // dropped a trip that is still running through March. The reach-back
          // is the prefilter's whole job — the exact answer is worked out in
          // memory below.
          OR: [
            {
              endDate: { gte: reachBackFrom(window.from) },
            },
            {
              endDate: null,
              date: { gte: reachBackFrom(window.from) },
            },
          ],
          // Owned first, privacy second — not the privacy fragment alone.
          // `Happening.contact` is a *required* relation on the composite
          // `(ownerId, contactId)` key, and a dump restored with foreign-key
          // checks off can leave a row pointing at a contact that resolves
          // only in another account. Unlocked, the fragment is `{}`, so such a
          // row reached the select and Prisma refused to return a required
          // relation as null — rejecting the whole `Promise.all` and taking
          // the page down rather than dropping one row.
          contact: { ownerId, ...(scope.unlocked ? {} : { isPrivate: false }) },
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
        // Newest anchor first, so if the cap ever bites it keeps the rows
        // nearest the window rather than an arbitrary slice of the year the
        // reach-back reopened.
        orderBy: { date: "desc" },
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
            // Same requirement as the happening above, one level down:
            // `InteractionParticipant.contact` is required on the same
            // composite key, so a restored participant naming another
            // account's contact would fail the select rather than be skipped.
            where: { contact: { ownerId } },
            select: { contact: { select: { id: true, firstName: true, lastName: true } } },
            take: 1,
          },
        },
        orderBy: { occurredAt: "asc" },
        take: PER_SOURCE_CAP,
      }),
    ]);

  // One bucket per kind, and the cap is applied to every one of them at the
  // end. Capping the database rows instead is the mistake this has now been
  // through twice: a birthday row projects into as many occurrences as the
  // window holds, and a happening row expands to a chip on every day it
  // covers, so four hundred rows of either became thousands of entries and the
  // documented per-source bound meant nothing. Bucketing makes the bound true
  // by construction rather than true wherever somebody remembered it.
  const byKind: Record<CalendarKind, CalendarEntry[]> = {
    plan: [],
    date: [],
    task: [],
    happening: [],
    interaction: [],
  };

  for (const plan of planRows) {
    if (!plan.plannedFor) continue;
    byKind.plan.push({
      id: `plan:${plan.id}`,
      kind: "plan",
      day: plainDateFromDb(plan.plannedFor),
      title: plan.title,
      href: "/ideas",
      contact: plan.contact,
      minute: plan.plannedStartMinute,
      // "Pencilled in" and "planned" are different promises, and the column
      // cannot tell them apart on its own: "Not planned after all" returns a
      // plan to OPEN and deliberately leaves `plannedFor` behind, so a day
      // that was called off looks exactly like one somebody roughly intends.
      // The status is the only thing that separates them, so it is said out
      // loud rather than left for the reader to assume the stronger one.
      note: plan.status === "PLANNED" ? "planned" : "pencilled in",
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

    // And a one-off needs a known year as well as a known day. `MONTH_DAY`
    // stores `UNKNOWN_YEAR` — 1904 — as a placeholder, which is harmless while
    // a recurrence is projecting it into whichever year was asked for, and a
    // lie the moment it is not: a date that happened once, with no year
    // recorded, would sit on the 1904 calendar presenting the sentinel as the
    // year it happened. Precision and recurrence are set independently, so
    // this combination is one the form will happily produce.
    if (row.recurrence === "NONE" && !hasKnownYear(row.precision)) continue;

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
      // Defeating the `today` clamp above buys past months their birthdays; it
      // also lets a recurrence run backwards past its own anchor, so somebody
      // born in 1990 acquired a birthday in the 1980 calendar. Only where the
      // year is real, though: a `MONTH_DAY` anchor stores `UNKNOWN_YEAR`
      // precisely because nobody knows it, and dropping those would empty the
      // grid of every birthday whose year was never recorded.
      if (hasKnownYear(row.precision) && diffPlainDays(row.anchor, day) < 0) continue;
      byKind.date.push({
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
    byKind.task.push({
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
    // A happening happens once, so an unknown start year is not a placeholder
    // to project through — it is a start nobody can place. `MONTH_DAY` stores
    // 1904, and `happeningSpan` takes that literally: paired with a real end
    // date, "March 10th" through 20 March 2026 is a span of a hundred and
    // twenty years, and the clamps below would then put a chip on every square
    // of every grid before it. Precision is chosen per end independently, so
    // this pair is one the form will make.
    if (!hasKnownYear(happening.precision)) continue;

    const span = happeningSpan(happeningDatesOf(happening));
    // On every day it covers that the window shows, because that is what a trip
    // looks like on a calendar. The span is already widened to cover a vague
    // end, so this is the honest reading of "away from the 3rd to the 10th"
    // rather than a single marker on the 3rd.
    // Clamped to the window at both ends: the later of the two starts, the
    // earlier of the two ends. Reading `diffPlainDays(a, b)` as "b minus a" is
    // what makes these two lines look symmetrical when they are opposites, and
    // getting the second one backwards spread a three-day trip across every
    // remaining square of the month.
    const first = diffPlainDays(window.from, span.start) >= 0 ? span.start : window.from;
    const last = diffPlainDays(span.end, window.to) >= 0 ? span.end : window.to;
    for (let day = first; diffPlainDays(day, last) >= 0; day = addPlainDays(day, 1)) {
      byKind.happening.push({
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
    byKind.interaction.push({
      id: `interaction:${interaction.id}`,
      kind: "interaction",
      day,
      title: interaction.title ?? "Caught up",
      href: "/timeline",
      contact: interaction.participants[0]?.contact ?? null,
      // Read off the clock rather than measured from midnight — see
      // `zonedMinuteOfDay`. The two disagree by an hour on the days that are
      // not 24 hours long, and it is the minute that is displayed and sorted.
      minute: zonedMinuteOfDay(interaction.occurredAt, timezone),
      note: null,
    });
  }

  // Earliest first inside each bucket before its cap bites, so a month that
  // somehow holds more than the cap keeps the start of it rather than an
  // arbitrary scatter of whichever rows the database happened to return.
  const entries: CalendarEntry[] = [];
  for (const kind of Object.keys(byKind) as CalendarKind[]) {
    const bucket = byKind[kind];
    bucket.sort((a, b) => diffPlainDays(b.day, a.day));
    entries.push(...bucket.slice(0, PER_SOURCE_CAP));
  }

  // Within a day: timed things first in clock order, then the all-day ones
  // alphabetically, so the order is stable between renders rather than however
  // the five queries happened to come back.
  entries.sort((a, b) => {
    // `diffPlainDays(b.day, a.day)` is a minus b, which is already the sign a
    // comparator wants for ascending order. Negating it — the obvious-looking
    // thing to do — sorts the whole calendar backwards.
    const byDate = diffPlainDays(b.day, a.day);
    if (byDate !== 0) return byDate;
    if (a.minute !== b.minute) {
      if (a.minute === null) return 1;
      if (b.minute === null) return -1;
      return a.minute - b.minute;
    }
    return a.title.localeCompare(b.title);
  });

  return entries;
}
