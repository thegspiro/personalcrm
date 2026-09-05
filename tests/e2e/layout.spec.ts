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
  "/people/friends",
  "/timeline",
  "/dating",
  "/dating/compare",
  "/family",
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

test("family sections and suggestions do not widen the page", async ({ page }) => {
  await ensureSignedIn(page);

  // Long names in a family the app can reason about: the suggestion card shows
  // a truncating name *and* a sentence naming three people, which is where the
  // contact page last blew its width. A bare contact never exercised this.
  const stamp = Date.now().toString(36);
  const gran = `Wilhelmina Featherstonehaugh ${stamp}`;
  const parent = `Bartholomew Featherstonehaugh ${stamp}`;
  const child = `Persephone Featherstonehaugh ${stamp}`;

  await createContact(page, gran);
  const parentUrl = await createContact(page, parent);
  const childUrl = await createContact(page, child);

  const family = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add a relative" }) });

  for (const [url, relative] of [
    [parentUrl, gran],
    [childUrl, parent],
  ] as const) {
    await page.goto(url);
    await family.getByRole("button", { name: "Add a relative" }).click();
    await family.getByLabel("Search people").fill(relative);
    await family.getByRole("button", { name: new RegExp(relative) }).click();
    await family.getByLabel("Is their…").selectOption({ label: "Parent" });
    await family.getByRole("button", { name: "Link", exact: true }).click();
    await expect(family.getByRole("link", { name: relative })).toBeVisible();
  }

  // The youngest now has a suggested grandparent, phrased with all three names
  // in one sentence — the widest string the family UI ever renders.
  await page.goto(childUrl);
  await expect(page.getByText("Possible relatives")).toBeVisible();
  await expect(page.getByText(new RegExp(`${gran}.*grandparent`))).toBeVisible();

  const contactResult = await overflow(page);
  expect(contactResult.offenders, "overflowing elements on a contact page").toEqual([]);
  expect(contactResult.scrollWidth).toBeLessThanOrEqual(contactResult.clientWidth);

  await page.goto("/family");
  await page.waitForLoadState("load");
  const familyResult = await overflow(page);
  expect(familyResult.offenders, "overflowing elements on /family").toEqual([]);
  expect(familyResult.scrollWidth).toBeLessThanOrEqual(familyResult.clientWidth);
});
