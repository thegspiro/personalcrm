import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { privacyScope, viaContactPrivacyWhere } from "@/server/privacy/filter";
import {
  addPlainDays,
  comparePlainDates,
  plainDateToDb,
  todayInTz,
  type PlainDate,
} from "@/lib/dates";
import {
  happeningPhase,
  happeningSpan,
  type AvailabilityImpact,
  type HappeningPhase,
} from "@/lib/happenings";
import { happeningDatesOf } from "@/server/services/happenings";

/**
 * Reads for informal calendar information — what the people you know have on.
 *
 * Happenings carry no `isPrivate` of their own, like life events and plans, so
 * the anchor contact is the marker and `viaContactPrivacyWhere` is the whole
 * filter. It is applied here rather than in a component because a server
 * component's rows are fetched and serialised into the payload before anything
 * decides not to render them.
 */

const ROW_SELECT = {
  id: true,
  contactId: true,
  title: true,
  notes: true,
  source: true,
  date: true,
  precision: true,
  endDate: true,
  endPrecision: true,
  availability: true,
  isTentative: true,
  followUpTaskId: true,
  acknowledgedAt: true,
  type: { select: { id: true, label: true, icon: true, color: true } },
} satisfies Prisma.HappeningSelect;

type HappeningRow = Prisma.HappeningGetPayload<{ select: typeof ROW_SELECT }>;

export interface HappeningItem {
  id: string;
  contactId: string;
  title: string;
  notes: string | null;
  source: string | null;
  date: PlainDate;
  precision: HappeningRow["precision"];
  endDate: PlainDate | null;
  endPrecision: HappeningRow["endPrecision"];
  availability: AvailabilityImpact;
  isTentative: boolean;
  hasFollowUp: boolean;
  acknowledged: boolean;
  phase: HappeningPhase;
  type: { id: string; label: string; icon: string | null; color: string | null } | null;
}

function toItem(row: HappeningRow, today: PlainDate): HappeningItem {
  const dates = happeningDatesOf(row);
  return {
    id: row.id,
    contactId: row.contactId,
    title: row.title,
    notes: row.notes,
    source: row.source,
    date: dates.date,
    precision: dates.precision,
    endDate: dates.endDate,
    endPrecision: dates.endPrecision,
    availability: row.availability,
    isTentative: row.isTentative,
    hasFollowUp: row.followUpTaskId !== null,
    acknowledged: row.acknowledgedAt !== null,
    phase: happeningPhase(dates, today),
    type: row.type,
  };
}

/**
 * One person's happenings, soonest first.
 *
 * Ordered ascending rather than newest-first: this list is read to find out
 * what is coming, so the next thing belongs at the top. Rows already past are
 * kept — "how did the move go?" is the other half of what this is for — and
 * the caller dims them by `phase`.
 */
export async function listContactHappenings(
  ownerId: string,
  contactId: string,
  timezone: string,
): Promise<HappeningItem[]> {
  const scope = await privacyScope();
  const today = todayInTz(timezone);

  const rows = await prisma.happening.findMany({
    where: { ownerId, contactId, ...viaContactPrivacyWhere(scope) },
    select: ROW_SELECT,
    orderBy: [{ date: "asc" }, { title: "asc" }],
  });

  return rows.map((row) => toItem(row, today));
}

export interface HappeningDigestEntry extends HappeningItem {
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    avatarPath: string | null;
  };
}

export interface HappeningDigest {
  /** Starting inside the window, plus anything already under way. */
  ahead: HappeningDigestEntry[];
  /** Finished recently and not yet acknowledged — the "ask how it went" list. */
  justEnded: HappeningDigestEntry[];
}

export interface HappeningDigestOptions {
  windowDays: number;
  lookBackDays: number;
  limit: number;
}

/**
 * The dashboard's two lists, in one pass.
 *
 * Both ends are widened by the largest span a partial date can cover, then
 * narrowed exactly in memory: a row stored as "October" has to be considered
 * for a window in the middle of October, and a SQL comparison against its
 * anchor of October 1st would miss it. The database bound is therefore a
 * cheap prefilter, not the answer — `happeningPhase` is.
 *
 * Every boundary is anchored to the user's timezone, never the server clock.
 */
export async function getHappeningsDigest(
  ownerId: string,
  timezone: string,
  options: HappeningDigestOptions,
): Promise<HappeningDigest> {
  const scope = await privacyScope();
  const today = todayInTz(timezone);

  const windowEnd = addPlainDays(today, Math.max(0, options.windowDays));
  const windowStart = addPlainDays(today, -Math.max(0, options.lookBackDays));
  // A YEAR-precision anchor sits up to 365 days before the last day it means,
  // so the lower bound has to reach back that far or the row is dropped before
  // `happeningPhase` ever sees it.
  const earliest = plainDateToDb(addPlainDays(windowStart, -366));
  const latestStart = plainDateToDb(windowEnd);

  const rows = await prisma.happening.findMany({
    where: {
      ownerId,
      ...viaContactPrivacyWhere(scope),
      // Anything still relevant starts on or before the window ends...
      date: { lte: latestStart },
      // ...and has not finished before it begins. Bounding on `date` alone
      // would drop a sabbatical that started last year and is still running,
      // which is exactly the row the "are they around?" question is about.
      OR: [
        { endDate: { gte: earliest } },
        { endDate: null, date: { gte: earliest } },
      ],
    },
    select: {
      ...ROW_SELECT,
      contact: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
    },
    orderBy: [{ date: "asc" }],
  });

  const ahead: HappeningDigestEntry[] = [];
  const justEnded: HappeningDigestEntry[] = [];

  for (const row of rows) {
    const entry: HappeningDigestEntry = { ...toItem(row, today), contact: row.contact };
    const span = happeningSpan(entry);

    if (entry.phase === "ended") {
      // Acknowledged rows have been dealt with; older ones have gone stale.
      if (entry.acknowledged) continue;
      if (comparePlainDates(span.end, windowStart) < 0) continue;
      justEnded.push(entry);
      continue;
    }

    // Ongoing rows are always relevant; upcoming ones only inside the window.
    if (entry.phase === "ongoing" || comparePlainDates(span.start, windowEnd) <= 0) {
      ahead.push(entry);
    }
  }

  // Soonest first ahead, most recently finished first for the follow-ups.
  ahead.sort((a, b) => comparePlainDates(happeningSpan(a).start, happeningSpan(b).start));
  justEnded.sort((a, b) => comparePlainDates(happeningSpan(b).end, happeningSpan(a).end));

  const limit = Math.max(1, options.limit);
  return { ahead: ahead.slice(0, limit), justEnded: justEnded.slice(0, limit) };
}
