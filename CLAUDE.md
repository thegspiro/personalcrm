# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted personal relationship manager — for the people in your life, not
sales leads. Next.js 15 (App Router) + React 19 + Prisma + MariaDB, packaged as
a single container with MariaDB bundled in and supervised by s6-overlay.

Deep documentation lives in [`docs/`](docs/). Reference:
[architecture](docs/architecture.md), [data model](docs/data-model.md),
[server actions](docs/server-actions.md), [privacy](docs/privacy.md),
[configuration](docs/configuration.md), [testing](docs/testing.md). Operator
guides: [install](docs/install.md), [first run](docs/first-run.md),
[backup](docs/backup.md), [upgrade](docs/upgrade.md),
[troubleshooting](docs/troubleshooting.md). Keep them current with the code;
[CONTRIBUTING.md](CONTRIBUTING.md) says which document a given change touches.

## Commands

Requires Node 22 and a reachable MariaDB.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your database
npx prisma migrate dev        # create the schema
SEED_DEMO=1 npm run db:seed   # optional demo account and sample data
npm run dev
```

| Command | Does |
| --- | --- |
| `npm run dev` / `npm run build` | Development server / production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: unit + integration |
| `npm run test:watch` | Vitest watch mode |
| `npx playwright test` | End-to-end, against an **already-running** instance |
| `npm run db:migrate` | Create and apply a migration (dev) |
| `npm run db:deploy` | Apply pending migrations (what the container runs) |
| `npm run db:studio` | Browse the database |
| `npm run lint` | ESLint (`eslint .`, flat config in `eslint.config.mjs`). `next.config.ts` sets `eslint.ignoreDuringBuilds`, so a build never catches lint — the CI lint job is what does |
| `npm run lint:sw` | Parses `public/sw.js` with **classic-script** grammar. ESLint ignores the worker and it is not TypeScript, so this is its only static check — and `node --check` is not equivalent, since `type: "module"` makes it accept `export` and top-level `await` that a classic worker rejects |
| `npm run changelog` | What is pending in `CHANGELOG.d/`; `changelog:check` validates, `changelog:release` folds them into `CHANGELOG.md` |
| `npm run verify` | typecheck → lint → lint:sw → changelog:check → changelog:guard → test → build, in one command |

Before pushing: `npm run verify`, plus `npx playwright test` for UI changes. CI
(`.github/workflows/ci.yml`) runs the same set on every PR — quality, unit +
integration, end-to-end against the standalone bundle, and a container build
with a clean-volume boot.

**One `tsc` error reads as three broken jobs.** `next build` typechecks, and
the end-to-end and container jobs both build first, so a single missing import
fails Typecheck, End-to-end and Container build together. Treat three red ticks
as one bug until proven otherwise.

### Running one test

```bash
npx vitest run tests/unit/cadence.test.ts          # one file
npx vitest run -t "counts forward from the last"   # one case by name
npx playwright test tests/e2e/privacy.spec.ts --project=mobile
```

### Integration tests need their own database

Set `TEST_DATABASE_URL` in `.env`. Without it the integration suites **skip
silently**; they never fall back to `DATABASE_URL`.

```
TEST_DATABASE_URL="mysql://user:pass@127.0.0.1:3306/personalcrm_test"
```

The database name **must end in `_test`** — `tests/integration/db.ts` throws
otherwise, because `reset()` truncates every table. `fileParallelism` is off:
the suites share one database.

E2E expects an instance at `http://127.0.0.1:3200` (override with
`E2E_BASE_URL`), runs one worker, and the `first-run` project creates the
account the other two projects sign in with.

## Architecture

```
src/lib/               pure logic — no Prisma, no server-only, no request context
src/server/queries/    reads for pages (privacy-filtered, owner-scoped)
src/server/actions/    server actions — the entire write surface
src/server/services/   multi-step writes shared by several actions (take a Tx client)
src/server/privacy/    the lock: state, where-fragments, offline eligibility
src/app/(app)|(auth)|(onboarding)
                       routes;  src/app/api/ has two route handlers: health
                       and the authenticated avatar read
```

There is no REST API and no client data store. Pages are server components
querying Prisma directly; mutations are server actions returning
`ActionResult { ok, error?, fieldErrors?, data? }` from `actions/helpers.ts`.
Path alias `@/*` → `./src/*`.

## Invariants — these have each been a bug already

1. **Never write `Contact.lastInteractionAt` or `nextTouchAt` directly.** Go
   through `src/server/services/contact-activity.ts`, which recomputes from the
   full interaction history. Assigning from the row just written makes a
   backdated log read as "spoke today" and silently clears someone off the
   overdue list — the one thing this app exists to get right. Deleting the
   newest interaction must fall back to the one before it; future-dated
   interactions are excluded.
2. **Anchor every date calculation to `UserContext.timezone`**, never to
   `process.env.TZ` or the server clock.
3. **Enforce privacy in the query, not the component.** With server components,
   a hidden section's rows have already been fetched and serialised into the
   payload. Use the where-fragments in `src/server/privacy/where.ts` — counts
   included, because a total that shifts on unlock is itself a disclosure.
4. **Treat every server action as a public POST endpoint.** Re-validate input,
   re-check the privacy lock, scope by `ownerId`. The page having been gated is
   not a guarantee.
5. **A new "type" is a `TaxonomyTerm` row, not an enum** — unless the code
   itself branches on it. Add defaults to `src/server/taxonomy/defaults.ts`;
   `runStartupTasks` backfills every existing account at boot, so no migration
   and no manual seed step.
6. **Nothing is destroyed by a status change.** Ending a relationship re-types
   it to its `former` counterpart, settling a debt records a date, converting a
   date to a friend keeps the profile. Deletion is always explicit.
7. **Unknown gets its own enum value** (`UNSPECIFIED` in `ReachedOutBy` and
   `WhoPaid`), so historical rows never silently acquire an answer nobody gave.
8. **Partial dates stay partial.** Every historical date carries a
   `DatePrecision`; storing "in 2019" as `2019-01-01` turns a vague memory into
   a confident-looking lie.
9. **A write that resolves a place goes through `transact`**
   (`src/server/db/transaction.ts`), never a bare `prisma.$transaction`.
   `Location` is the schema's most contended row — every interaction, plan and
   date naming a venue writes it — and from MariaDB 11.6.2 a write to a row that
   moved since the transaction's snapshot rolls the *whole transaction* back
   rather than failing the statement. Catching that and carrying on is the trap:
   the connection is no longer in a transaction, so the rest of the save
   autocommits one statement at a time. Starting again is the only answer.

## Adding a table

1. Edit `prisma/schema.prisma` (give it `ownerId` unless it only ever exists
   beneath a `Contact`), then `npm run db:migrate`.
2. **Read the generated SQL.** Prisma diffs shape, not meaning: when a change
   re-expresses existing data, the generated migration drops the old column and
   takes the information with it. Hand-edit to backfill *before* the drop, in
   the same migration —
   `20260824084606_add_life_events_and_date_precision` is the worked example.
   Never edit a migration that has shipped.
3. Add the table to `TABLES` in `tests/integration/db.ts`. Forgetting this leaks
   rows between tests and produces failures that look like anything except the
   real cause.
4. If it carries `isPrivate`: add it to `countPrivateRows`
   (`src/server/privacy/counts.ts`) **and** give it a where-fragment. Forgetting
   the count is silent — offline caching stays on and the private row is written
   to disk by the service worker.
5. Sweep it in the relevant delete path. Note `CustomFieldValue.entityId` is
   **not** a foreign key (it points at four tables), so nothing cascades and
   every delete path sweeps it by hand.
6. Update `docs/data-model.md` and add an entry file to `CHANGELOG.d/`
   (never `CHANGELOG.md` directly — see **Merging** below).

## Merging main into a branch

Merge before final validation, then **validate the merged tree, not just your
own edits**. A clean merge is not a verified merge — git resolves text, not
meaning, and all of these merged with no conflict reported:

- Both sides added the same name to one import list → `tsc` redeclaration.
- Both sides added the same `let` to `public/sw.js` → the worker stopped
  parsing, so it never installed and offline reading died silently. Nothing
  static catches that except `npm run lint:sw`.
- A test kept driving a label main had renamed → the file merged perfectly.
- A page gained a widget on each side; the destructuring named only one.

Re-run `npm run verify` and the e2e suite *after* merging. Resolve conflicts by
understanding both intents, never by taking one side wholesale; when both sides
add something in the same place, the answer is usually both.

Changelog entries go in `CHANGELOG.d/`, one file per change, precisely so that
two branches cannot collide over the top of `## [Unreleased]` — which was this
repository's most common conflict, and on several branches its only one.

Editing `CHANGELOG.md` by hand fails CI and `npm run verify`. It is checked
rather than asked for because asking did not work: of the five pull requests
opened in the hour after the convention shipped, all five edited
`CHANGELOG.md` and none added a fragment — and four of them were branched from
a `main` that already carried the instruction.

## Things that look optional but are not

- **Quick add does not need `src/server/ai/`.** The feature is
  `src/lib/quick-parse.ts` — local, no key, no network, always on. The AI layer
  only improves a reading of awkward phrasing; it is off by default, nothing in
  it runs while it is off, its runtime path sits behind a dynamic `import()` in
  a `try` so an unreachable endpoint degrades to the local reading, its answer
  is re-run through the local matcher rather than trusted, and a line naming a
  private contact never leaves the machine whatever the toggle says. The same
  holds for `src/server/geo/`. What is *not* true of either — and used to be
  claimed here — is that the directory can simply be deleted: the settings page
  and its action import the provider table statically, so removing one is a
  build change.
- **Mobile-first is tested, not assumed.** `tests/e2e/layout.spec.ts` asserts no
  route scrolls horizontally. `truncate` only shrinks when *every* flex and grid
  ancestor carries `min-w-0` (both default to `min-width: auto`); overflow on a
  phone pushes buttons off-screen where they look tappable and are not. Input
  font size has a 16px floor outside `@layer` so no utility can defeat it —
  anything smaller makes iOS zoom in on focus and never zoom back out.
- **Offline caching is opt-in per page** and only offered when the server has
  proven the account is safe to cache (lock closed, or nothing private exists).
  Locking or signing out wipes it. Writes are never queued.

## Not implemented (do not assume otherwise)

Important-date, overdue cadence, due-task, and timezone-aware daily digest
reminders are delivered by the hourly scheduler through the channels configured
under Settings → Reminders. Each delivery has a durable policy-specific key and
retries re-check current owner, state, policy, and privacy before sending.
`UserPreference.weekStartsOn` is likewise reserved and read by nothing. The
`svc-backup` service writes a daily dump to `/config/backups`, tags have a UI
under Settings → Tags and on the people list, and Settings → Account manages
the display name, email, password and signed-in sessions. Password recovery is
still deliberately absent. Full list in
[docs/README.md](docs/README.md#known-gaps).

## Commits

Read `git log` before writing one. The convention is a short subject, then a
body explaining **the decision and what it prevents** — not a list of changed
files. Bugs found along the way are named explicitly, including how they were
found. The `Phase N` prefixes in the existing log record how the work happened;
they are not a rule for new commits.
