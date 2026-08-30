import { expect, test } from "@playwright/test";
import { createContact, ensureSignedIn } from "./helpers";

/**
 * The dating module end to end: profile, dates, flags, pipeline, compare,
 * ending, and converting back to an ordinary contact.
 */
test.describe.configure({ mode: "serial" });

const STAMP = `${process.env.E2E_RUN_ID ?? "local"}-${Date.now().toString(36)}`;

function personName(): string {
  return `Dating ${test.info().project.name} ${STAMP}`;
}

let contactUrl = "";

test("mark someone as dating and fill in their profile", async ({ page }) => {
  await ensureSignedIn(page);
  contactUrl = await createContact(page, personName());

  // The dating sections only appear once they're flagged as romantic.
  await page.goto(`${contactUrl}/edit`);
  await page.getByText("Dating or interested").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(contactUrl);

  const dating = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "End it" }).or(page.getByLabel("Private notes")) })
    .first();
  await expect(dating).toBeVisible();

  await dating.getByRole("button", { name: "Talking", exact: true }).click();
  await dating.getByLabel("Relationship style").fill("Monogamous");
  await dating.getByLabel("Private notes").fill("Funnier over text than in person.");
  await dating.getByRole("button", { name: "Save", exact: true }).click();

  await expect(dating.getByText("Monogamous")).toBeVisible();
});

test("log three dates, one of them backdated into the middle", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  // Scope by the add button rather than the title: `hasText` is
  // case-insensitive, so "Dates" also matches the "Important dates" section.
  const dates = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Log a date" }) })
    .first();

  async function logDate(venue: string, monthsBack: number) {
    await dates.getByRole("button", { name: "Log a date" }).click();
    await dates.getByRole("button", { name: "Coffee", exact: true }).click();
    for (let i = 0; i < monthsBack; i++) {
      await dates.getByRole("button", { name: "−1 month" }).click();
    }
    await dates.getByLabel("Where").fill(venue);
    await dates.getByRole("button", { name: "Log it" }).click();
    await expect(dates.getByText(venue)).toBeVisible();
  }

  await logDate("Oldest Cafe", 3);
  await logDate("Newest Bar", 0);
  // Remembered late, but it happened in between the other two.
  await logDate("Middle Diner", 1);

  // Sequence follows when dates happened, not the order they were entered.
  await expect(dates.getByText("Date 1 — Oldest Cafe")).toBeVisible();
  await expect(dates.getByText("Date 2 — Middle Diner")).toBeVisible();
  await expect(dates.getByText("Date 3 — Newest Bar")).toBeVisible();
});

test("dates appear in the unified timeline", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const timeline = page.locator("section").filter({ hasText: "Timeline" }).first();
  await expect(timeline.getByText(/Middle Diner/).first()).toBeVisible();
});

test("add green and red flags", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const flags = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add a flag" }) })
    .first();

  await flags.getByRole("button", { name: "Add a flag" }).click();
  await flags.getByRole("button", { name: "Green" }).click();
  await flags.getByLabel("What did you notice?").fill("Kind to waiters without thinking about it");
  await flags.getByRole("button", { name: "Add", exact: true }).click();
  await expect(flags.getByText("GREEN FLAGS")).toBeVisible();

  await flags.getByRole("button", { name: "Add a flag" }).click();
  await flags.getByRole("button", { name: "Red" }).click();
  await flags.getByLabel("What did you notice?").fill("Cancelled twice with an hour's notice");
  await flags.getByRole("button", { name: "Add", exact: true }).click();
  await expect(flags.getByText("RED FLAGS")).toBeVisible();
});

test("save something to do, then log the date it becomes", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill("Late showing at the Alamo");
  await plans.getByRole("button", { name: "Movie", exact: true }).click();
  await plans.getByLabel("Where").fill("Alamo Drafthouse");
  await plans.getByLabel("City").fill("Arlington");
  await plans.getByLabel("Address").fill("2900 Columbia Pike, Arlington, VA 22204");
  await plans.getByLabel("Notes").fill("Book the back row before Friday.");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  await expect(plans.getByText("Late showing at the Alamo")).toBeVisible();
  await expect(plans.getByText("Alamo Drafthouse")).toBeVisible();
  await expect(plans.getByText("2900 Columbia Pike, Arlington, VA 22204")).toBeVisible();
  const mapLink = plans.getByRole("link", { name: /Check .* on OpenStreetMap/ });
  await expect(mapLink).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/search?query=2900%20Columbia%20Pike%2C%20Arlington%2C%20VA%2022204",
  );

  await plans.getByRole("button", { name: "Edit plan" }).click();
  await plans.getByLabel("Address").fill("2900 Columbia Pike, Arlington, VA 22204, United States");
  await plans.getByLabel("Notes").fill("Book the back row; parking is behind the venue.");
  await plans.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    plans.getByText("2900 Columbia Pike, Arlington, VA 22204, United States"),
  ).toBeVisible();
  await expect(plans.getByText("Book the back row; parking is behind the venue.")).toBeVisible();

  if ((page.viewportSize()?.width ?? 1000) < 640) {
    const overflow = await plans.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await expect(
      plans.getByRole("link", { name: /Check .* on OpenStreetMap/ }),
    ).toBeVisible();
  }

  // The date log offers it, prefills where it is, and closes it out on save.
  const dates = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Log a date" }) })
    .first();

  await dates.getByRole("button", { name: "Log a date" }).click();
  await dates.getByLabel("From a saved idea").selectOption({ label: "Late showing at the Alamo" });
  await expect(dates.getByLabel("Where")).toHaveValue("Alamo Drafthouse");
  await dates.getByRole("button", { name: "Log it" }).click();

  await expect(dates.getByText(/Alamo Drafthouse/).first()).toBeVisible();
  await expect(plans.getByText("Late showing at the Alamo")).toHaveCount(0);
});

test("the pipeline groups them by stage and can move them", async ({ page }) => {
  await ensureSignedIn(page);
  const name = personName();

  await page.goto("/dating");
  const card = page.locator("li").filter({ hasText: name }).first();
  await expect(card).toBeVisible();

  // Move them along; the section they sit in changes with them.
  await card.getByRole("combobox", { name: new RegExp(`Stage for ${name}`) }).selectOption({ label: "Dating" });
  await expect(page.getByRole("heading", { name: "Dating", level: 3 })).toBeVisible();
});

test("the dating page keeps date ideas saved for nobody in particular", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/dating");

  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(`Kayak the Potomac ${STAMP}`);
  await plans.getByRole("button", { name: "Outdoors", exact: true }).click();
  await plans.getByLabel("Where").fill("Key Bridge Boathouse");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  await expect(plans.getByText(`Kayak the Potomac ${STAMP}`)).toBeVisible();
  // Not saved against anyone, and the list says so.
  await expect(plans.getByText("Anyone").first()).toBeVisible();

  // The same row is on the general list, which is the point of generalising it.
  await page.goto("/ideas");
  await expect(page.getByText(`Kayak the Potomac ${STAMP}`)).toBeVisible();
});

test("compare sorts and opens a side-by-side", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/dating/compare");

  const table = page.locator("table").first();
  await expect(table).toBeVisible();
  await table.getByRole("button", { name: /Dates/ }).click();

  const rows = page.getByRole("checkbox");
  const count = await rows.count();
  test.skip(count < 2, "needs at least two people in the pipeline");

  await rows.nth(0).click();
  await rows.nth(1).click();
  await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible();
});

test("ending records the reason and the retrospective separately", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  const dating = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "End it" }) })
    .first();
  await dating.getByRole("button", { name: "End it" }).click();

  await page.getByLabel("What happened?").fill("She's moving to Chicago.");
  await page.getByLabel("Looking back").fill("I waited too long to say what I wanted.");
  await page.getByRole("button", { name: "Record it" }).click();

  await expect(dating.getByText("Why it ended")).toBeVisible();
  await expect(dating.getByText("Looking back")).toBeVisible();
});

test("converting to a friend keeps the history", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto(contactUrl);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Just a friend" }).click();

  // The dating sections go, but everything logged is still there.
  // Target the section's own add button: `hasText` is case-insensitive, so
  // filtering sections on "Dates" would also match "Important dates".
  await expect(page.getByRole("button", { name: "Log a date" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a flag" })).toHaveCount(0);
  // ...but things to do are not a dating section, so that one stays.
  await expect(page.getByRole("button", { name: "Add something to do" })).toHaveCount(1);
  const timeline = page.locator("section").filter({ hasText: "Timeline" }).first();
  await expect(timeline.getByText(/Middle Diner/).first()).toBeVisible();

  // And they've left the pipeline.
  await page.goto("/dating");
  await expect(page.getByText(personName())).toHaveCount(0);
});
