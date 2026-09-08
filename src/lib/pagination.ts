/**
 * Paging a list page, from a `?page=` parameter.
 *
 * Offset paging rather than cursors, deliberately. Cursors win on data that is
 * large or being appended to while you read it; a personal address book is
 * neither, and offsets buy two things cursors cannot: a URL you can bookmark or
 * share that still means the same thing, and the ability to say "page 3 of 7"
 * instead of only "there is more". `list-cap.ts` explains why a bounded window
 * needed saying out loud at all; this is what to do once it has been said.
 *
 * Every function here is total: a parameter that is missing, negative, absurd,
 * or past the end resolves to a page that exists, because the alternative is a
 * shared link that renders an empty list and looks like data loss.
 */

export interface PageWindow {
  /** 1-based, and always within the list. */
  page: number;
  skip: number;
  take: number;
}

export interface PageInfo extends PageWindow {
  /**
   * Null for a list whose total is not worth computing.
   *
   * A single table answers `count` for the price of one query. The timeline
   * does not: it merges five sources and projects recurring dates into
   * occurrences, so the only way to total it is to build the whole thing. A
   * pager that says "Next" without claiming to know how many pages follow is
   * honest; one that guesses is not.
   */
  total: number | null;
  pageCount: number | null;
  /** 1-based inclusive positions of the rows on this page; 0 when empty. */
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * The page a `?page=` value asks for, before the total is known.
 *
 * Clamped at the bottom only — the upper bound needs a count, which the caller
 * does not have yet. `describePage` clamps the top once it does.
 */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const page = Math.trunc(parsed);
  return page < 1 ? 1 : page;
}

/** What to hand Prisma for a given page. */
export function pageWindow(page: number, pageSize: number): PageWindow {
  const size = Math.max(1, Math.trunc(pageSize));
  const safe = Math.max(1, Math.trunc(page));
  return { page: safe, skip: (safe - 1) * size, take: size };
}

/**
 * Everything a pager needs, with the page clamped into the list.
 *
 * A page past the end resolves to the last one rather than rendering nothing.
 * That case is not hypothetical: it is what a bookmarked `?page=6` does after
 * the rows behind it are archived, and an empty list with no explanation reads
 * as lost data rather than as a stale link.
 */
export function describePage(total: number, page: number, pageSize: number): PageInfo {
  const size = Math.max(1, Math.trunc(pageSize));
  const rows = Math.max(0, Math.trunc(total));
  // At least one page, so an empty list is "page 1 of 1" rather than "of 0".
  const pageCount = Math.max(1, Math.ceil(rows / size));
  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount);

  const skip = (current - 1) * size;
  return {
    page: current,
    skip,
    take: size,
    total: rows,
    pageCount,
    from: rows === 0 ? 0 : skip + 1,
    to: Math.min(skip + size, rows),
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  };
}

/**
 * A page of a feed too expensive to count, from one over-fetched row.
 *
 * The caller fetches `skip + pageSize + 1` and passes how many came back. The
 * extra row is the entire signal — exactly the trick `applyCap` uses, which is
 * why this reads as its successor rather than as a second mechanism.
 *
 * The cost of the offset is real and worth stating: reaching page five means
 * building five pages and discarding four. That is the price of paging a
 * merged feed at all, it is bounded by how deep anybody actually goes, and
 * filtering remains the faster way to the far end.
 */
export function describeFeedPage(
  fetched: number,
  page: number,
  pageSize: number,
): PageInfo {
  const size = Math.max(1, Math.trunc(pageSize));
  const current = Math.max(1, Math.trunc(page));
  const skip = (current - 1) * size;
  const shown = Math.max(0, Math.min(size, fetched - skip));

  return {
    page: current,
    skip,
    take: size,
    total: null,
    pageCount: null,
    from: shown === 0 ? 0 : skip + 1,
    to: shown === 0 ? 0 : skip + shown,
    hasPrevious: current > 1,
    hasNext: fetched > skip + size,
  };
}

/** The parameter name every paged list uses. */
export const PAGE_PARAM = "page";

/**
 * The same query string pointing at a different page.
 *
 * Page one omits the parameter entirely, so the first page of a list has one
 * canonical URL rather than two that render identically.
 */
export function pageHref(
  pathname: string,
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  page: number,
): string {
  const next =
    params instanceof URLSearchParams
      ? new URLSearchParams(params.toString())
      : toSearchParams(params);

  if (page <= 1) next.delete(PAGE_PARAM);
  else next.set(PAGE_PARAM, String(Math.trunc(page)));

  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function toSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Keep every value: a repeated parameter is not the same request as its
      // first value, and collapsing one here would quietly drop a filter.
      for (const entry of value) out.append(key, entry);
    } else {
      out.set(key, value);
    }
  }
  return out;
}
