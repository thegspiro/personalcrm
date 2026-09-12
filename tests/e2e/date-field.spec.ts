import { expect, test, type Page } from "@playwright/test";
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

/**
 * The date-and-time field, driven with no typing at all.
 *
 * The native `datetime-local` indicator is a few millimetres wide and opens a
 * different widget in every browser, so the calendar is the app's own. These
 * cover the two things that make it worth having: a day can be reached with a
 * pointer without touching the keyboard, and the whole grid can be reached
 * with the keyboard without touching a pointer.
 */
const pad = (value: number) => String(value).padStart(2, "0");

/** Split what the field holds: `2026-09-11T18:00`. */
function readWhen(value: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day, time };
}

/** A day key `n` days after the given one, without going through a local Date. */
function dayKey(from: { year: number; month: number; day: number }, offset: number) {
  const moved = new Date(Date.UTC(from.year, from.month - 1, from.day + offset));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

test("a day and a time can be chosen from the calendar without typing", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Log an interaction" }).click();

  const when = page.getByRole("dialog").getByLabel("When");
  const opened = readWhen(await when.inputValue());

  await page.getByRole("button", { name: "Open calendar" }).click();
  await expect(page.getByRole("grid")).toBeVisible();

  // The month the field already reads, so opening the calendar never loses
  // where you were.
  const previous = new Date(Date.UTC(opened.year, opened.month - 2, 15));
  const target = `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-15`;

  await page.getByRole("button", { name: "Previous month" }).click();
  await page.locator(`[data-day="${target}"]`).click();

  // The day changed and the time did not: "the 15th, same time of day" is what
  // someone backfilling means, and re-reading the clock would quietly move it.
  await expect(when).toHaveValue(`${target}T${opened.time}`);

  await page.getByLabel("Time", { exact: true }).fill("07:45");
  await expect(when).toHaveValue(`${target}T07:45`);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("grid")).toBeHidden();
  await expect(when).toHaveValue(`${target}T07:45`);
});

test("the calendar opens on the selected day and walks from the keyboard", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Log an interaction" }).click();

  const when = page.getByRole("dialog").getByLabel("When");
  const opened = readWhen(await when.inputValue());
  const selected = `${opened.year}-${pad(opened.month)}-${pad(opened.day)}`;

  await page.getByRole("button", { name: "Open calendar" }).click();
  // Not the "previous month" button, which is what a popover focuses by
  // default. The day already chosen is what someone opening a calendar is
  // looking for, and it is the only tab stop in the grid.
  await expect(page.locator(`[data-day="${selected}"]`)).toBeFocused();

  // Down a row, back a day: a week earlier plus six days, which is yesterday
  // — and it crosses into the previous month whenever the 1st is close.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  const expected = dayKey(opened, -6);
  await expect(page.locator(`[data-day="${expected}"]`)).toBeFocused();

  // Enter commits the focused day. The sheet must not submit: the grid is
  // portalled out of the form, and every square is a `type="button"`.
  await page.keyboard.press("Enter");
  await expect(when).toHaveValue(`${expected}T${opened.time}`);
  await expect(page.getByRole("grid")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid")).toBeHidden();
});

/**
 * The account's first day of the week, reaching a picker six components below
 * the page that knows it.
 *
 * Asserted through the setting rather than through a prop, because the prop
 * was never the risk: the picker sits under a sheet opened by a floating
 * button the app shell renders, and what could go wrong is the preference not
 * arriving at all — which looks like nothing at all, a calendar that begins on
 * Sunday because that is the default.
 */
async function setWeekStart(page: Page, day: "Sunday" | "Monday") {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Look" }).click();
  await page.getByLabel("Weeks start on").selectOption({ label: day });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();
}

/** The grid's first column, as the popover on the dashboard draws it. */
async function firstColumn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Log an interaction" }).click();
  await page.getByRole("button", { name: "Open calendar" }).click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  return grid.getByRole("columnheader").first();
}

test("the calendar begins on the day the account chose", async ({ page }) => {
  await ensureSignedIn(page);

  try {
    await setWeekStart(page, "Monday");
    await expect(await firstColumn(page)).toHaveText("Mo");
  } finally {
    // Restored even when the assertion above fails: this file runs serially
    // and the calendar suite reads the same column.
    await setWeekStart(page, "Sunday");
  }

  await expect(await firstColumn(page)).toHaveText("Su");
});
