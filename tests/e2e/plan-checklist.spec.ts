import { expect, test } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

test("a plan checklist can be created, edited, checked and deleted without mobile overflow", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Picnic checklist ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await plans.getByLabel("Checklist item 1", { exact: true }).fill("Confirm Sunday availability");
  await plans.getByLabel("Mark Confirm Sunday availability complete").check();
  await plans.getByLabel("Delete checklist item 2").click();
  await plans.getByRole("button", { name: "Add item" }).click();
  await plans.getByLabel("Checklist item 5", { exact: true }).fill("Pack a picnic blanket");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  let row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.getByLabel("Checklist item 1", { exact: true })).toHaveValue("Confirm Sunday availability");
  await expect(plans.getByLabel("Mark Confirm Sunday availability complete")).toBeChecked();
  await expect(plans.locator('input[value="Reserve or buy tickets"]')).toHaveCount(0);
  await expect(plans.locator('input[value="Pack a picnic blanket"]')).toBeVisible();

  await plans.getByLabel("Delete checklist item 5").click();

  // The editor closes only once the refreshed row has rendered, and its Save
  // button stays disabled until then: React renders the refresh together
  // with the update that ends the form's pending state, so the form is
  // pending for as long as the refresh takes, and a second click — which
  // would save the same form twice — is not possible. The refresh is slowed
  // so that window is wide enough to look at.
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (headers["rsc"] === "1" && !headers["next-action"]) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  // Watched from inside the page, not sampled from outside: a state that
  // lasts one frame is exactly the one a poll misses. The observer runs after
  // every task that touched the editor or the button and looks at what is
  // on screen then — the states a click could land on, which is the point.
  // A state a render creates and undoes inside one task was never on screen
  // and is rightly not counted. Counting starts with the first disabled Save
  // it sees, which is the submit being registered; the click itself touches
  // the tree a moment before that, while the button is rightly still live.
  await page.evaluate(() => {
    const watch = { checks: 0, liveWhileOpen: 0, armed: false };
    (window as unknown as { __saveWatch: typeof watch }).__saveWatch = watch;
    const editorField = () => {
      const label = Array.from(document.querySelectorAll("label")).find(
        (candidate) => candidate.textContent?.trim() === "What do you want to do?",
      );
      return label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    };
    const saveButton = () =>
      Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Save") ?? null;
    new MutationObserver(() => {
      const button = saveButton();
      if (!watch.armed) {
        if (button?.disabled) watch.armed = true;
        return;
      }
      watch.checks += 1;
      if (editorField() && button && !button.disabled) watch.liveWhileOpen += 1;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  });
  const save = plans.getByRole("button", { name: "Save", exact: true });
  const editor = plans.getByLabel("What do you want to do?");
  const clicked = Date.now();
  await save.click();
  await expect(save).toBeDisabled();
  await expect(editor).toBeHidden();
  await page.unroute("**/*");
  // The slowed refresh is what makes the check mean anything: an editor that
  // closed before the delay elapsed was not waiting on it.
  expect(Date.now() - clicked, "the editor closed before the slowed refresh could have landed").toBeGreaterThanOrEqual(1500);
  const watch = await page.evaluate(
    () => (window as unknown as { __saveWatch: { checks: number; liveWhileOpen: number; armed: boolean } }).__saveWatch,
  );
  expect(watch.armed, "the observer never saw the submit register").toBe(true);
  expect(watch.checks, "the observer saw nothing change after the submit").toBeGreaterThan(0);
  expect(watch.liveWhileOpen, "Save was live while the editor was still open").toBe(0);

  // Waiting for it to close is waiting for the save to be reflected.
  // Reopening it straight away used to show — and could save back — the
  // checklist as it was before the edit; this reopen is what guards that.
  await expect(editor).toBeHidden();
  row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.locator('input[value="Pack a picnic blanket"]')).toHaveCount(0);
});

test("the checklist is on the row, tickable there, and closed plans can be looked back up", async ({ page }) => {
  // Everything here was already being stored and none of it was on screen: the
  // checklist only existed inside the editor, and closing a plan out removed it
  // from the only list that ever showed it.
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Row checklist ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);
  // Five starter items, one of them ticked before saving.
  await plans.getByLabel("Mark Confirm availability complete").check();
  await plans.getByRole("button", { name: "Save", exact: true }).click();
  await expect(plans.getByText(title)).toBeVisible();

  const row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  const summary = row.locator("summary").filter({ hasText: "Checklist" });
  await expect(summary).toHaveText("Checklist · 1 of 5");
  await summary.click();

  // Ticked from the row itself, with no editor opened. The row's checkboxes are
  // named for the item alone — the editor's say "Mark … complete" — so the two
  // never collide while an add panel is open over a list of existing rows.
  //
  // `click` and then assert, rather than `check`. This box holds no state of
  // its own: it says what the server last said, so it only turns once the
  // action has been round-tripped and the refreshed tree has rendered.
  // `check()` verifies the moment its click returns and does not wait for any
  // of that, so it reports a working tick as a click that changed nothing —
  // which is exactly how this read on the first three runs, with the count and
  // the box in the failure snapshot both already correct.
  const travel = row.getByRole("checkbox", { name: "Check travel time" });
  await travel.click();
  await expect(travel).toBeChecked();
  await expect(summary).toHaveText("Checklist · 2 of 5");

  await page.reload();
  const reloaded = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  await expect(reloaded.locator("summary").filter({ hasText: "Checklist" })).toHaveText(
    "Checklist · 2 of 5",
  );

  // Closing it out takes it off the open list, which is what made it look lost.
  await reloaded.getByLabel("Mark as done").click();
  await expect(plans.getByText(title)).toHaveCount(0);

  await page.getByRole("link", { name: "Including done" }).click();
  const closed = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first()
    .locator("[tabindex='-1']")
    .filter({ hasText: title })
    .first();
  await expect(closed.getByText("done", { exact: true })).toBeVisible();
  // The controls that would only ever error are not offered on a closed row.
  await expect(closed.getByLabel("Mark as done")).toHaveCount(0);
  await expect(closed.locator("summary").filter({ hasText: "Schedule it" })).toHaveCount(0);

  await closed.getByRole("button", { name: "Back on the list" }).click();
  await page.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page.getByText(title)).toBeVisible();
});

test("a duration with no day shows, and survives an edit that does not touch it", async ({ page }) => {
  // Two things at once, both of which this spec caught by failing. A duration
  // is kept when no day is set, so the row has to render it outside the day's
  // chip; and the editor has to re-offer the stored value, or an unrelated
  // save clears it.
  //
  // What it does not reach: a stored value outside the seven presets, which is
  // the case that broke the re-offering. The picker only offers presets, so it
  // cannot be produced from this form. `tests/integration/plans.test.ts` covers
  // the server accepting such a value; the re-offering itself is read, not run.
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Duration round-trip ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);
  await plans.getByLabel("Set aside").selectOption("120");
  await plans.getByRole("button", { name: "Save", exact: true }).click();
  await expect(plans.getByText(title)).toBeVisible();

  // `SectionRow` renders a div with tabindex="-1", not an <li> — the same
  // locator the two tests above use.
  const row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();
  // Exact, and not for tidiness: the schedule form inside this same row lists
  // every contact as an <option>, and the e2e fixtures generate names from
  // random characters. One of them containing "2h" is enough for a substring
  // match to resolve to two elements and fail on strict mode — which is exactly
  // how this first went red, on a run where the name was "Ondrelldesktoplocalmtor2hnb".
  await expect(row.getByText("2h", { exact: true })).toBeVisible();

  // Reopen, change something else entirely, and save.
  await row.getByRole("button", { name: "Edit plan" }).click();
  await expect(plans.getByLabel("Set aside")).toHaveValue("120");
  await plans.getByLabel("Venue").fill("The park");
  await plans.getByRole("button", { name: "Save", exact: true }).click();

  await expect(row.getByText("The park")).toBeVisible();
  await expect(row.getByText("2h", { exact: true })).toBeVisible();
});

test("a plan can be scheduled and then closed out", async ({ page }) => {
  // The two new actions through the UI. The copy-versus-in-place rule for a
  // plan saved against nobody is covered in tests/integration/plans.test.ts,
  // which can assert on both rows; this drives the controls.
  await ensureSignedIn(page);
  await page.goto("/ideas");

  const title = `Schedule and finish ${Date.now()}`;
  const plans = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Add something to do" }) })
    .first();

  await plans.getByRole("button", { name: "Add something to do" }).click();
  await plans.getByLabel("What do you want to do?").fill(title);
  await plans.getByRole("button", { name: "Save", exact: true }).click();
  await expect(plans.getByText(title)).toBeVisible();

  const row = plans.locator("[tabindex='-1']").filter({ hasText: title }).first();

  // The disclosure and the submit both read "Schedule it", so the summary is
  // located by its element and the submit by its role.
  await row.locator("summary").filter({ hasText: "Schedule it" }).click();

  // The day goes in through the popover's own text box, as in happenings.spec.
  // `DateField` portals its content, so the trigger is inside the row and
  // everything it opens — the presets included — is at page scope. Enter
  // commits and closes, so there is nothing to dismiss afterwards.
  await row.getByRole("button", { name: "Which day?", exact: true }).click();
  const day = page.getByLabel("Type a date");
  await day.fill("today");
  await day.press("Enter");
  await expect(day).toBeHidden();

  await row.getByLabel("Start time").fill("19:30");
  // Off unless asked for, which is the point of asking here: leaving this alone
  // saves the plan with no reminders at all.
  await row.getByLabel("Remind me").selectOption("on-day");
  await row.getByRole("button", { name: "Schedule it", exact: true }).click();

  // Exact: "Not planned after all" contains "planned" too.
  await expect(row.getByText("planned", { exact: true })).toBeVisible();
  await expect(row.getByText("7:30 PM")).toBeVisible();
  // The policy on the row, so a reminder that will arrive is visible without
  // opening anything. Only shown once the plan is actually PLANNED — the
  // scheduler reads no other status.
  await expect(row.getByText("Reminder · on the day")).toBeVisible();

  // Closing it out records what it became, so it leaves the open list.
  await row.getByLabel("Mark as done").click();
  await expect(plans.getByText(title)).toHaveCount(0);
});
