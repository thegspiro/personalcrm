## What this does

<!-- One or two sentences. The diff shows what changed; this says what it is. -->

## The decision, and what it prevents

<!--
The convention in `git log` is to explain the decision and what it prevents,
not to list the files that changed. Same here — this section is where the
reasoning goes, so it survives longer than the branch.

If you found a bug along the way, name it, and say how you found it.
-->

## How it was verified

<!--
What you actually ran, not what you intended to run. CI covers typecheck,
lint, build, unit + integration, end-to-end and a container boot — say here
what CI cannot: a migration against real data, a phone you held, a restart
you watched.
-->

- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `npx playwright test` — required for UI changes
- [ ] Integration tests actually ran (`TEST_DATABASE_URL` set), not skipped

## Checks that apply

<!-- Delete every line that does not apply to this change. -->

**Touched interactions, dates or cadences**
- [ ] `lastInteractionAt` / `nextTouchAt` are written only via `contact-activity.ts`
- [ ] Backdating and deleting the newest interaction are both covered by a test
- [ ] Every date calculation is anchored to `UserContext.timezone`, not the server clock
- [ ] Partial dates carry a `DatePrecision` rather than being padded to a real day

**Touched anything private, or the dating layer**
- [ ] Filtering happens in the query, via `privacy/where.ts` — not in a component
- [ ] Counts are filtered too
- [ ] New write paths re-check the lock rather than trusting the page was gated

**Added a table or column**
- [ ] Generated SQL was read; a change that re-expresses existing data backfills **before** the drop, in the same migration
- [ ] Added to `TABLES` in `tests/integration/db.ts`
- [ ] If it carries `isPrivate`: added to `countPrivateRows` **and** given a where-fragment
- [ ] Swept in the relevant delete path (`CustomFieldValue` cascades from nothing — sweep it by hand)
- [ ] `docs/data-model.md` updated

**Added a server action**
- [ ] Input re-validated server-side and scoped by `ownerId`
- [ ] Returns `ActionResult`
- [ ] `docs/server-actions.md` updated

**Touched the UI**
- [ ] Checked at phone width; no route scrolls horizontally
- [ ] Every flex and grid ancestor of a `truncate` carries `min-w-0`
- [ ] No input font size below 16px

**Added a new "type"**
- [ ] It is a `TaxonomyTerm` in `taxonomy/defaults.ts`, not an enum — unless the code branches on it
- [ ] Unknown has its own value, so historical rows do not acquire an answer nobody gave

## Documentation

- [ ] `CHANGELOG.md` updated for anything user-visible
- [ ] The relevant `docs/` page updated — the table in `CONTRIBUTING.md` says which
