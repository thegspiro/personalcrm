import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * No page may scroll horizontally.
 *
 * This is easy to break by accident: a `truncate` only shrinks if every flex or
 * grid ancestor between it and the viewport carries `min-w-0`, because both
 * default to `min-width: auto`. One long name then pushes the whole page wider
 * than the screen, and on a phone that also makes fixed elements land in the
 * wrong place — a submit button can look visible while being unclickable.
 */
const ROUTES = [
  "/",
  "/people",
  "/timeline",
  "/dating",
  "/dating/compare",
  "/tasks",
  "/ideas",
  "/gifts",
  "/more",
  "/settings",
];

async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;

    /**
     * Wide content is fine as long as it scrolls inside its own container —
     * that is exactly what the filter chip rows do. Only report elements that
     * push past the viewport with nothing to scroll them.
     */
    const scrollsHorizontally = (el: HTMLElement): boolean => {
      let cur: HTMLElement | null = el.parentElement;
      while (cur && cur !== document.body) {
        const overflowX = getComputedStyle(cur).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const worst: string[] = [];
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && !scrollsHorizontally(el)) {
        worst.push(`${el.tagName}.${(el.className || "").toString().slice(0, 60)} right=${Math.round(r.right)}`);
      }
    });

    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: vw,
      offenders: worst.slice(0, 5),
    };
  });
}

for (const route of ROUTES) {
  test(`${route} does not scroll horizontally`, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto(route);
    await page.waitForLoadState("load");

    const result = await overflow(page);
    expect(result.offenders, `overflowing elements on ${route}`).toEqual([]);
    expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
  });
}

test("a contact with a very long name does not widen the page", async ({ page }) => {
  await ensureSignedIn(page);

  // Long, unbroken-ish name — the exact shape that used to blow the layout out.
  const name = `Wilhelmina Aurelia Featherstonehaugh ${Date.now().toString(36)}`;
  const url = await createContact(page, name);

  await page.goto(url);
  await page.waitForLoadState("load");

  const result = await overflow(page);
  expect(result.offenders, "overflowing elements on the contact page").toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);

  // The name is still shown, just truncated rather than pushing the page wide.
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
});
