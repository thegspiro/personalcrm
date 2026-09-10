import { comparePlainDates, type PlainDate } from "@/lib/dates";

/** The profile keeps this summary deliberately short so it stays useful context. */
export const MILESTONE_SUMMARY_LIMIT = 3;

type MilestoneCandidate = {
  date: PlainDate;
  isMilestone: boolean;
};

/**
 * Pick pinned context independently of the chronological event list. Returning
 * references rather than removing rows is intentional: milestones still
 * belong in the full history below.
 *
 * The sort is not redundant with the caller's ordering. A profile merges the
 * contact's own events with the ones they only participate in, and the newest
 * three milestones have to come from both halves.
 */
export function recentMilestones<T extends MilestoneCandidate>(
  events: readonly T[],
): T[] {
  return events
    .filter((event) => event.isMilestone)
    .toSorted((left, right) => comparePlainDates(right.date, left.date))
    .slice(0, MILESTONE_SUMMARY_LIMIT);
}
