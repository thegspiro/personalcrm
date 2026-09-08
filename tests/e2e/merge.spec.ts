import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * Finding and merging a duplicate, end to end.
 *
 * The assertion that matters is the last one: after the merge, the interaction
 * logged against the record that was folded away is on the survivor. A merge
 * that loses history is the failure this whole feature has to not have.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;
const SHARED = `dup-${STAMP}@example.com`;
const KEEP = `Keeper ${STAMP}`;
const FOLD = `Folded ${STAMP}`;

async function addPerson(page: import("@playwright/test").Page, name: string) {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(name);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(name), level: 2 })).toBeVisible();
  return page.url();
}

test("two people sharing an address are offered as a possible duplicate", async ({ page }) => {
  await ensureSignedIn(page);

  for (const name of [KEEP, FOLD]) {
    await addPerson(page, name);
    const methods = page.locator("section").filter({ hasText: "How to reach them" });
    await methods.getByRole("button", { name: "Add a way to reach them" }).click();
    await methods.getByRole("button", { name: "Email", exact: true }).click();
    await methods.getByLabel("Number, address or handle").fill(SHARED);
    await methods.getByRole("button", { name: "Add", exact: true }).click();
    await expect(methods.locator(`a[href="mailto:${SHARED}"]`)).toBeVisible();
  }

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByRole("heading", { name: "Possible duplicates" })).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: KEEP }).filter({ hasText: FOLD }),
  ).toHaveCount(1);
});

test("merging moves the history onto the record that is kept", async ({ page }) => {
  await ensureSignedIn(page);

  // Something on the record that is about to be folded away.
  await page.goto("/people");
  await page.getByRole("link", { name: new RegExp(FOLD) }).first().click();
  await page.getByRole("button", { name: "Log interaction" }).click();
  await page.getByRole("button", { name: "Coffee", exact: true }).click();
  await page.getByLabel("Title").fill(`Merged history ${STAMP}`);
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(`Merged history ${STAMP}`)).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Data" }).click();

  // Scoped to this pair's own row, never `.first()`. The rest of the suite
  // creates contacts that legitimately share a detail — contact-methods.spec
  // files the same number twice — so the first suggestion on the page is
  // frequently somebody else's, and the feature is right to be offering it.
  const ours = page.locator("li").filter({ hasText: KEEP }).filter({ hasText: FOLD });
  await ours.getByRole("link", { name: "Review" }).click();

  await expect(page.getByRole("heading", { name: "Merge two people" })).toBeVisible();
  // Irreversibility is stated, not implied.
  await expect(page.getByText(/cannot be undone/i)).toBeVisible();

  // Scoped to the "which record" group: the per-field radios are labelled with
  // a person's name too, which is correct for them and ambiguous for a bare
  // role query.
  await page.locator('input[name="winner"]').first().check();
  const keeper = page.getByRole("group", { name: /Which record/ });
  await keeper.getByRole("radio", { name: new RegExp(KEEP) }).check();
  await page.getByRole("button", { name: new RegExp(`Merge into ${KEEP}`) }).click();

  // If the merge is refused the reason is a toast; surface it rather than
  // failing later on a missing heading with no explanation.
  const refusal = page.locator("[data-sonner-toast]");
  if (await refusal.first().isVisible().catch(() => false)) {
    const text = await refusal.first().innerText();
    expect(text, `merge was refused: ${text}`).toContain("Merged into");
  }

  // The survivor's page, carrying the folded record's history.
  await expect(page.getByRole("heading", { name: new RegExp(KEEP), level: 2 })).toBeVisible();
  await expect(page.getByText(`Merged history ${STAMP}`)).toBeVisible();

  // And the other record is gone.
  await page.goto("/people");
  await expect(page.getByRole("link", { name: new RegExp(FOLD) })).toHaveCount(0);
});

test("the suggestion is gone once the pair has been merged", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Data" }).click();
  // This pair specifically — other suggestions may legitimately remain.
  await expect(
    page.locator("li").filter({ hasText: KEEP }).filter({ hasText: FOLD }),
  ).toHaveCount(0);
});
