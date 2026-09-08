import { describe, expect, it } from "vitest";
import {
  describeFeedPage,
  describePage,
  pageHref,
  pageWindow,
  parsePage,
} from "@/lib/pagination";

describe("reading ?page=", () => {
  it("defaults to the first page when absent", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
  });

  it("reads a real page number", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4", "9"])).toBe(4);
  });

  it("never returns a page that cannot exist", () => {
    // A hand-edited URL must not produce a negative skip, which Prisma rejects
    // outright — an error page for a typo somebody can make in the address bar.
    for (const raw of ["0", "-1", "-999", "abc", "NaN", "Infinity", "1e999"]) {
      expect(parsePage(raw), raw).toBeGreaterThanOrEqual(1);
    }
  });

  it("truncates rather than rounding a fractional page", () => {
    expect(parsePage("2.9")).toBe(2);
  });
});

describe("the window handed to the database", () => {
  it("starts at zero on the first page", () => {
    expect(pageWindow(1, 50)).toEqual({ page: 1, skip: 0, take: 50 });
  });

  it("offsets by whole pages", () => {
    expect(pageWindow(3, 50)).toEqual({ page: 3, skip: 100, take: 50 });
  });

  it("refuses a page size that would divide by nothing", () => {
    expect(pageWindow(2, 0).take).toBe(1);
    expect(pageWindow(2, -10).take).toBe(1);
  });
});

describe("describing a page to the reader", () => {
  it("counts pages, and positions within them", () => {
    const info = describePage(247, 2, 50);
    expect(info.pageCount).toBe(5);
    expect(info.from).toBe(51);
    expect(info.to).toBe(100);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it("stops the last page at the last row", () => {
    const info = describePage(247, 5, 50);
    expect(info.from).toBe(201);
    expect(info.to).toBe(247);
    expect(info.hasNext).toBe(false);
  });

  it("clamps a page past the end back into the list", () => {
    // What a bookmarked ?page=6 does once the rows behind it are archived. An
    // empty list with no explanation reads as lost data rather than a stale
    // link.
    const info = describePage(60, 99, 50);
    expect(info.page).toBe(2);
    expect(info.skip).toBe(50);
    expect(info.hasNext).toBe(false);
  });

  it("calls an empty list page one of one", () => {
    const info = describePage(0, 1, 50);
    expect(info.pageCount).toBe(1);
    expect(info.from).toBe(0);
    expect(info.to).toBe(0);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it("does not offer a second page for an exactly full one", () => {
    expect(describePage(50, 1, 50).hasNext).toBe(false);
    expect(describePage(51, 1, 50).hasNext).toBe(true);
  });
});

describe("building the link to another page", () => {
  it("keeps every other parameter", () => {
    const href = pageHref("/people", { q: "sam", sort: "recent" }, 3);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("q")).toBe("sam");
    expect(params.get("sort")).toBe("recent");
    expect(params.get("page")).toBe("3");
  });

  it("leaves the parameter off page one, so it has one canonical URL", () => {
    expect(pageHref("/people", { q: "sam" }, 1)).toBe("/people?q=sam");
    expect(pageHref("/people", {}, 1)).toBe("/people");
  });

  it("replaces an existing page rather than appending a second", () => {
    const href = pageHref("/people", { page: "2", q: "sam" }, 4);
    expect(new URLSearchParams(href.split("?")[1]).getAll("page")).toEqual(["4"]);
  });

  it("keeps a repeated parameter, which is not the same as its first value", () => {
    const href = pageHref("/people", { tag: ["a", "b"] }, 2);
    expect(new URLSearchParams(href.split("?")[1]).getAll("tag")).toEqual(["a", "b"]);
  });

  it("accepts URLSearchParams as readily as a record", () => {
    const href = pageHref("/timeline", new URLSearchParams({ q: "coffee" }), 2);
    expect(href).toBe("/timeline?q=coffee&page=2");
  });
});

describe("paging a feed that is too expensive to count", () => {
  // The caller fetches `skip + pageSize + 1` and reports how many came back;
  // the extra row is the whole signal, exactly as `applyCap` uses it.
  it("offers a next page only when the extra row came back", () => {
    expect(describeFeedPage(101, 1, 100).hasNext).toBe(true);
    expect(describeFeedPage(100, 1, 100).hasNext).toBe(false);
    expect(describeFeedPage(37, 1, 100).hasNext).toBe(false);
  });

  it("never claims to know a total or a page count", () => {
    const info = describeFeedPage(101, 1, 100);
    expect(info.total).toBeNull();
    expect(info.pageCount).toBeNull();
  });

  it("positions rows within the whole feed, not within the page", () => {
    const info = describeFeedPage(250, 2, 100);
    expect(info.skip).toBe(100);
    expect(info.from).toBe(101);
    expect(info.to).toBe(200);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it("stops the last page where the rows stop", () => {
    const info = describeFeedPage(250, 3, 100);
    expect(info.from).toBe(201);
    expect(info.to).toBe(250);
    expect(info.hasNext).toBe(false);
  });

  it("reports an emptied page rather than a negative range", () => {
    // A page past the end of a feed: nothing was fetched for it, and the range
    // has to read as empty rather than as 501-500.
    const info = describeFeedPage(120, 6, 100);
    expect(info.from).toBe(0);
    expect(info.to).toBe(0);
    expect(info.hasNext).toBe(false);
    expect(info.hasPrevious).toBe(true);
  });
});
