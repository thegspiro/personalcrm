/**
 * List caps, and telling the truth about them.
 *
 * Every list page in this app draws a bounded window rather than paginating —
 * personal-scale data does not need cursors, and a phone does not want them.
 * The bug that produces is silent: a page that fetches 200 rows and renders
 * 200 cards looks complete whether the account holds 200 people or 2,000, and
 * the ones past the cap are indistinguishable from ones that were never added.
 *
 * The fix is to over-fetch by exactly one row. If that row comes back, the cap
 * bit, and the page can say so. One extra row costs nothing and is the only
 * way to know the difference without a second COUNT.
 */

export interface CappedList<T> {
  /** At most `cap` rows, in the order they arrived. */
  items: T[];
  /** True when the query returned more than the cap admits. */
  truncated: boolean;
}

/**
 * Trim an over-fetched result down to its cap and report what was left behind.
 *
 * `rows` must have been fetched with `take: cap + 1`; fetching exactly `cap`
 * makes a full page indistinguishable from a truncated one.
 */
export function applyCap<T>(rows: readonly T[], cap: number): CappedList<T> {
  const limit = Math.max(0, Math.trunc(cap));
  return { items: rows.slice(0, limit), truncated: rows.length > limit };
}
