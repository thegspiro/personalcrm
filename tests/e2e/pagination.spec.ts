import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Paging past the window a list draws.
 *
 * The suite's account holds nowhere near two hundred people, so the assertions
 * here are about the mechanism rather than about reaching page five: that the
 * parameter is understood, that a page nobody can be on sends you to one that
 * exists, and that changing a filter does not strand you on a page the new
 * result does not have.
 */
test.describe.configure({ mode: "serial" });

test("a list with one page of results offers no pager", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  // A pager that only ever says "1 of 1" is furniture.
  await expect(page.getByRole("navigation", { name: "people pages" })).toHaveCount(0);
});

test("a page past the end lands on one that exists", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/people?page=99");

  // What a bookmarked deep link does once the rows behind it are gone. An
  // empty list under a pager would read as lost data.
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("a nonsense page parameter is not an error page", async ({ page }) => {
  await ensureSignedIn(page);

  for (const value of ["0", "-3", "abc"]) {
    await page.goto(`/people?page=${value}`);
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  }
});

test("the timeline understands the same parameter", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/timeline?page=1");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

test("changing a filter does not strand you on a page it does not have", async ({
  page,
}) => {
  await ensureSignedIn(page);
  await page.goto("/people?page=3");

  // Typing a search from page three must go back to page one of the results,
  // not to page three of them.
  await page.getByLabel("Search people").fill("zzzz-no-such-person");
  await expect(page).not.toHaveURL(/page=/);
  await expect(page.getByText("No one matches")).toBeVisible();
});
