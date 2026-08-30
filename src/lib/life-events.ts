/** The profile keeps this summary deliberately short so it stays useful context. */
export const MILESTONE_SUMMARY_LIMIT = 3;

type MilestoneCandidate = {
  date: { year: number; month: number; day: number };
  isMilestone: boolean;
};

/**
 * Pick pinned context independently of the chronological event list. Returning
 * references rather than removing rows is intentional: milestones still
 * belong in the full history below.
 */
export function recentMilestones<T extends MilestoneCandidate>(
  events: readonly T[],
): T[] {
  return events
    .filter((event) => event.isMilestone)
    .toSorted(
      (left, right) =>
        right.date.year - left.date.year ||
        right.date.month - left.date.month ||
        right.date.day - left.date.day,
    )
    .slice(0, MILESTONE_SUMMARY_LIMIT);
}
