# Contributing

## Getting a development instance up

Requires **Node 22** and a MariaDB you can reach.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your database
npx prisma migrate dev        # create the schema
SEED_DEMO=1 npm run db:seed   # optional: demo account and sample data
npm run dev
```

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run verify` | Everything below that CI also runs — the one to use before pushing |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run lint:sw` | `node --check public/sw.js`, which nothing else covers |
| `npm test` | Unit + integration (Vitest) |
| `npm run changelog` | What is pending in `CHANGELOG.d/` |
| `npm run test:watch` | Vitest in watch mode |
| `npx playwright test` | End-to-end, against a running instance |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply pending migrations (what the container runs) |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Backfill taxonomies; demo data with `SEED_DEMO=1` |

Add `TEST_DATABASE_URL` to `.env` — pointing at a **throwaway** database whose
name ends in `_test` — or the integration suites skip. See
[docs/testing.md](docs/testing.md).

## Before pushing

```bash
npm run verify
```

That is typecheck, lint, the service-worker parse check, the changelog check,
the unit and integration suites, and a production build — the same set CI runs,
in one command so that running it is easier than remembering it. For anything
touching the UI, add `npx playwright test` against a running instance. See
[docs/testing.md](docs/testing.md#ci).

**One `tsc` error usually reads as three broken jobs.** `next build`
typechecks, and both the end-to-end and container jobs build before they do
anything else, so a single missing import fails Typecheck, End-to-end *and*
Container build at once. Three red ticks are one bug until proven otherwise —
read the typecheck output first and re-run before chasing the other two.

## Merging `main` into a long-lived branch

Do this before final validation, not after — and then **validate the merge, not
just your own edits**. A clean merge is not a verified merge. Git resolves text;
it has no idea what the text means, and every one of these merged without
reporting a conflict:

- Two branches added the same name to one import list. Git kept both. `tsc`
  rejected the redeclaration.
- Two branches added the same `let` to `public/sw.js` at different points. Git
  kept both, and the service worker stopped parsing — so it never installed,
  and offline reading silently died.
- A branch's test kept driving a label that `main` had renamed. The test file
  merged perfectly; nothing overlapped.
- A page gained one widget on each side, and the destructuring that named them
  only mentioned one.

So: `git merge origin/main`, resolve whatever git *does* flag, then run
`npm run verify` and the end-to-end suite again on the merged tree. Resolve a
conflict by understanding both intents — never by taking one side wholesale
because it applies cleanly. When both sides add something to the same place,
the answer is usually both, in a sensible order.

If the branch you are merging into is someone else's, merge rather than rebase:
a merge commit keeps their checkout valid.

## Where code goes

| Kind of code | Home | Rule |
| --- | --- | --- |
| Pure logic | `src/lib/` | No Prisma, no `server-only`, no request context. If it can be pure, it goes here — that is what makes it testable |
| Reads | `src/server/queries/` | Scoped by `ownerId`, with the privacy filter applied |
| Writes | `src/server/actions/` | `"use server"`, returns `ActionResult` |
| Shared write logic | `src/server/services/` | Takes a transaction client so it composes inside a caller's transaction |
| UI | `src/components/<feature>/` | `ui/` is the Radix-backed primitives |

Full picture in [docs/architecture.md](docs/architecture.md).

## The rules that are not style preferences

These have each been a bug already.

1. **Never write `Contact.lastInteractionAt` or `nextTouchAt` directly.** Go
   through [`services/contact-activity.ts`](src/server/services/contact-activity.ts),
   which recomputes from full history. Assigning from the row you just wrote
   makes a backdated log read as "spoke today" and silently clears someone off
   the overdue list.
2. **Anchor every date calculation to `UserContext.timezone`**, never to
   `process.env.TZ` or the server clock.
3. **Enforce privacy in the query, not in the component.** With server
   components, a hidden section's rows have already been fetched and serialised
   into the payload. Use the where-fragments in
   [`server/privacy/where.ts`](src/server/privacy/where.ts) — counts included.
4. **Treat every server action as a public POST endpoint.** Re-validate input,
   re-check the lock, scope by `ownerId`. The browser is not a validator and the
   page having been gated is not a guarantee.
5. **A new type goes in a taxonomy, not an enum** — unless the application code
   itself branches on it.
6. **Nothing is destroyed by a status change.** Re-type, settle, archive.
7. **Unknown gets its own enum value.** `UNSPECIFIED` exists so historical rows
   do not silently acquire an answer nobody gave.

## Adding a table

1. Edit `prisma/schema.prisma`. Give it `ownerId` unless it only ever exists
   beneath a `Contact`. Comment *why* it exists, not what its columns are —
   the existing models are the house style.
2. `npm run db:migrate` and read the generated SQL before committing it.
3. Add the table to `TABLES` in `tests/integration/db.ts`. **Forgetting this
   leaks rows between tests and produces failures that look like anything except
   the real cause.**
4. If it carries `isPrivate`, add it to `countPrivateRows` in
   [`server/privacy/counts.ts`](src/server/privacy/counts.ts) **and** give it a
   where-fragment. Forgetting the count is silent: offline caching stays on and
   the private row is written to disk.
5. Add it to a delete path if it should not outlive its parent, and to the
   custom-field sweep if it can carry custom values.
6. Document it in [docs/data-model.md](docs/data-model.md) and add an entry to
   [`CHANGELOG.d/`](CHANGELOG.d/README.md), naming the migration on its
   `*Schema:*` line.

## Migrations

The container runs `prisma migrate deploy` at start, so a migration must apply
cleanly and unattended against a live database.

**Read the generated SQL every time.** Prisma diffs *shape*, not *meaning*: when
a change re-expresses existing data — as `DatePrecision` did for the old
`yearKnown` booleans — the generated migration will drop the old column and take
the information with it. Hand-edit to backfill **before** the drop, in the same
migration. `20260824084606_add_life_events_and_date_precision` is the worked
example.

Never edit a migration that has shipped. Add another one.

## Adding a default taxonomy term

Add it to `TAXONOMY_SEEDS` in
[`server/taxonomy/defaults.ts`](src/server/taxonomy/defaults.ts). Existing
accounts pick it up automatically: `runStartupTasks` re-provisions every account
at boot, without overwriting anything the user has renamed. No migration and no
manual seed step.

If it is a relationship type, set its `metadata` (`family`, `tier`,
`generation`, `role`) and pair it with its inverse — inference reads the stable
`role`, never the slug or label.

## Commit messages

The log is written for someone reading it in a year. Look at
`git log` before writing one: the convention here is a short subject line, then
a body that explains **the decision and what it prevents**, not a list of
changed files. Bugs found along the way are named explicitly, including how they
were found.

Nothing enforces a prefix convention — the phase numbering in the existing log
is a record of how the work happened, not a rule for future commits.

## Pull requests

[`.github/pull_request_template.md`](.github/pull_request_template.md) fills the
description in. Its conditional sections are the same invariants listed above —
delete the ones that do not apply rather than ticking them unread.

## Changelog

Entries go in [`CHANGELOG.d/`](CHANGELOG.d/README.md), one file per change,
never into `CHANGELOG.md` directly. `npm run changelog:release` folds them in.

The reason is merge behaviour rather than tidiness: every change wants the top
of `## [Unreleased]`, so two branches that both edit `CHANGELOG.md` conflict by
construction. It was the most common conflict in this repository by a wide
margin, and on several branches the only one. Two new files never conflict.

## Documentation

Update the docs in the same commit as the change:

| If you changed… | Update |
| --- | --- |
| The schema | [docs/data-model.md](docs/data-model.md) |
| A server action | [docs/server-actions.md](docs/server-actions.md) |
| Layering, startup, or a subsystem | [docs/architecture.md](docs/architecture.md) |
| The lock, offline rules, or the AI layer | [docs/privacy.md](docs/privacy.md) |
| An environment variable or `/config` | [docs/configuration.md](docs/configuration.md) |
| Anything user-visible | A new file in [`CHANGELOG.d/`](CHANGELOG.d/README.md) — never `CHANGELOG.md` itself |

A comment in the code explaining a non-obvious decision is worth more than a
paragraph in a document nobody opens — the schema and `src/lib/` are written
that way deliberately. Documents are for the shape of things; comments are for
the reasons.
