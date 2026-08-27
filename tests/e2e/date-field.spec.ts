import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * The date picker, driven the way a person drives it: one keystroke at a time.
 *
 * `fill()` would hide both of the bugs these cover. It sets the whole value in
 * one event, so it never produces the half-typed year that used to be rejected,
 * and it never leaves a day stranded in a month too short for it.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

test("a year can be retyped digit by digit", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Yeartype ${test.info().project.name} ${STAMP}`;

  await page.goto("/people/new");
  await page.getByLabel("First name").fill(name);

  const birthday = page.getByRole("button", { name: "Birthday", exact: true });
  await birthday.click();
  await page.getByRole("button", { name: "Exact date" }).click();

  // Every prefix of "1985" is out of range. The field used to reject each one
  // and re-render the year it already had, which reads as a stuck input.
  const year = page.getByLabel("Year", { exact: true });
  await year.click();
  await year.pressSequentially("1985");
  await page.getByLabel("Month", { exact: true }).selectOption({ label: "Feb" });
  const day = page.getByLabel("Day", { exact: true });
  await day.click();
  await day.pressSequentially("14");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(birthday).toContainText("February 14, 1985");

  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("heading", { name, level: 2 }).waitFor();

  // And it is the saved value, not just what the picker was showing.
  await page.goto(`${page.url()}/edit`);
  await expect(page.getByRole("button", { name: "Birthday", exact: true })).toContainText(
    "February 14, 1985",
  );
});

test("a day its month does not have is corrected rather than dropped", async ({ page }) => {
  await ensureSignedIn(page);
  const name = `Shortmonth ${test.info().project.name} ${STAMP}`;

  await page.goto("/people/new");
  await page.getByLabel("First name").fill(name);

  const birthday = page.getByRole("button", { name: "Birthday", exact: true });
  await birthday.click();
  await page.getByRole("button", { name: "Exact date" }).click();

  const year = page.getByLabel("Year", { exact: true });
  await year.click();
  await year.pressSequentially("1990");
  await page.getByLabel("Month", { exact: true }).selectOption({ label: "Jan" });
  const day = page.getByLabel("Day", { exact: true });
  await day.click();
  await day.pressSequentially("31");

  // 1990-02-31 is not a date. It used to be submitted anyway, and the server's
  // parse rejected it into `undefined` — the person saved with no birthday and
  // nothing said so.
  await page.getByLabel("Month", { exact: true }).selectOption({ label: "Feb" });
  await expect(birthday).toContainText("February 28, 1990");

  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("heading", { name, level: 2 }).waitFor();

  await page.goto(`${page.url()}/edit`);
  await expect(page.getByRole("button", { name: "Birthday", exact: true })).toContainText(
    "February 28, 1990",
  );
});
