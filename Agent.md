# Personal CRM Contributor Handbook

This handbook is the working contract for anyone modifying Personal CRM. It
consolidates the repository's engineering, privacy, validation, documentation,
Git, and delivery rules. It does not replace `AGENTS.md` or `CLAUDE.md`: read
both first. More-specific instructions and the stricter privacy, safety,
data-integrity, or validation requirement always win.

## What This Application Is

Personal CRM is a self-hosted relationship manager for people in a user's life,
not a sales CRM. It is a mobile-first Next.js 15 App Router application using
React 19, Prisma 6, and MariaDB. The deployable product is a standalone Next.js
bundle in one container; s6-overlay supervises the application and the bundled
MariaDB unless an external `DATABASE_URL` is supplied. Persistent container
state lives under `/config`.

### Architecture and data flow

There is no separate REST service and no client-side data store. The only route
handler is `GET /api/health`.

```text
server component ──> server query ──> Prisma ──> MariaDB
       │
client form ──> server action ──> shared service ──> Prisma transaction
                              └──> pure src/lib logic
```

| Area | Responsibility |
| --- | --- |
| `src/app/` | App Router pages: authenticated, auth, onboarding, and health routes |
| `src/components/` | Feature UI; `ui/` contains Radix-backed primitives |
| `src/lib/` | Pure, request-independent logic; no Prisma, `server-only`, or request context |
| `src/server/queries/` | Page reads, owner-scoped and privacy-filtered |
| `src/server/actions/` | The complete public write surface; validates and returns `ActionResult` |
| `src/server/services/` | Reusable multi-step writes accepting a Prisma transaction client |
| `src/server/privacy/` | Lock state, query fragments, private-row counts, and offline eligibility |
| `src/server/auth/`, `user/` | Sessions and per-request user/preferences context |
| `src/server/taxonomy/` | Default term definitions and per-account provisioning |
| `src/server/ai/` | Optional assisted parsing; local quick-add remains functional without it |
| `prisma/` | Schema, migrations, and seed entry point |
| `tests/` | Vitest unit/integration and Playwright end-to-end suites |
| `root/` | s6-overlay definitions embedded in the container |

Pages normally read through server queries. Mutations arrive as server actions,
resolve the owner and account timezone, parse and validate untrusted form data,
check privacy, perform related writes in a transaction, recompute derived data,
revalidate affected paths, and return `ActionResult { ok, error?, fieldErrors?,
data? }`.

### Persistence model and terminology

- **Owner:** the authenticated `User` whose data is being accessed. Top-level
  user data carries `ownerId`; child rows may be scoped through an owned parent.
- **User context:** the user plus preferences, especially the account timezone.
- **Privacy lock:** a per-session secondary-PIN access gate. It is not database
  encryption and does not replace authentication or ownership checks.
- **Private row:** a row hidden by database query conditions while the lock is
  closed. Counts are sensitive too.
- **Taxonomy term:** per-owner, renameable data for categories and types. Enums
  are for finite states on which application logic branches.
- **Partial date:** historical knowledge stored with `DatePrecision`; an unknown
  month or day must not be invented.
- **Contact activity:** denormalised `Contact.lastInteractionAt` and
  `nextTouchAt`, recomputed from interaction history by the activity service.
- **Offline eligibility:** a server decision allowing page caching only when
  the lock is closed or no private data exists. Offline writes are not queued.
- **Known gap:** schema, dependency, configuration, or UI scaffolding that is
  not an operating feature. Current gaps are catalogued in `docs/README.md`.

## Never Assume

**Never infer working behavior from a model, migration, dependency, type,
setting, route name, UI control, or document alone.** Before making a claim or
change, inspect the current implementation, all call sites, relevant tests,
Prisma schema, applicable migration SQL, documentation, runtime/build
configuration, package scripts, and CI workflow. Search for readers and writers,
including delete paths, startup tasks, privacy filters, counts, and offline code.

Documentation must describe **verified current behavior only**—never planned,
inferred, stubbed, migrated-but-unwired, or partially implemented behavior.
Reconcile stale prose against executable code and tests rather than copying it.
Examples called out by the repository today include notification/reminder
models without a sender, backup and upload directories without writers, and a
rendered avatar path without an upload flow.

## Mandatory Start-of-Task Checklist

Complete this before editing:

- [ ] Read repository and applicable nested `AGENTS.md` files, then read
  `CLAUDE.md`; preserve the strictest applicable rule.
- [ ] Read relevant `docs/` pages and `CONTRIBUTING.md`.
- [ ] Inspect the current branch, `git status`, upstream/tracking state, and
  recent history for the affected area.
- [ ] Fetch `origin/main` when the environment permits and understand branch
  divergence before deciding whether synchronization is appropriate.
- [ ] Inspect the existing implementation before replacing or refactoring it.
- [ ] Find every relevant caller, reader, writer, service, query, delete path,
  schema model, and migration.
- [ ] Inspect affected unit, integration, and end-to-end tests and identify the
  regression coverage the change requires.
- [ ] Read `.github/workflows/ci.yml`, `package.json`, test configuration, and
  relevant runtime/build configuration rather than relying on remembered
  commands.
- [ ] Identify privacy, ownership, timezone, persistence, historical-data,
  offline-cache, migration, operational, and documentation implications.
- [ ] Define a focused scope; do not mix unrelated cleanup into the change.

## Non-Negotiable Error Policy

Every compilation, type, lint, test, build, migration, privacy, data-integrity,
documentation, and CI error encountered—including an apparently pre-existing
error—must be investigated. Reproduce it, identify the first meaningful error,
determine whether it is deterministic, flaky, environmental, or change-caused,
and make a safe root-cause repair when reasonably feasible.

**Documenting an error is not a substitute for fixing it when a safe root-cause
repair is reasonably possible.** “Pre-existing” and “unrelated” are hypotheses,
not exemptions; substantiate them with branch/history comparison, a clean-base
reproduction, or equivalent evidence. Record how the issue was found and what
resolved it.

Never obtain green output by deleting or skipping a test, weakening an
assertion or coverage threshold, disabling validation, adding broad lint/type
suppressions, casting away an error, bypassing ownership/privacy checks, or
repeatedly rerunning a deterministic failure. Do not claim a failing or skipped
suite passed.

If a safe repair genuinely requires a large unrelated redesign, destructive
migration, security-policy decision, unavailable external dependency, or a
material scope expansion, stop speculative work and escalate explicitly. State
the exact error, commands and environment, investigation and evidence, user or
data risk, why a safe fix exceeds scope, and the safest next action. Do not
silently proceed past a correctness, privacy, migration, or CI problem.

## Privacy and Data-Integrity Invariants

These are correctness requirements, not style preferences:

1. **Scope every access to its owner.** Every server-side read and write uses
   `ownerId` or traverses a verified owner-scoped parent. Never trust a client ID
   or a page gate to establish ownership.
2. **Treat every server action as a public POST endpoint.** Resolve the owner,
   validate all input server-side, re-check privacy-lock state, authorize the
   target, and return the established `ActionResult` contract.
3. **Filter in the query.** Apply `src/server/privacy/where.ts` fragments before
   fetching rows. Hiding fetched data in a component can still serialize it in
   a server-component payload. Filter totals and aggregates as disclosures too.
4. **Use the account timezone.** Anchor date parsing, cadence, birthday,
   overdue, and boundary calculations to `UserContext.timezone`, never
   `process.env.TZ`, the host timezone, or an implicit server-local date.
5. **Use the contact-activity service.** Never write
   `Contact.lastInteractionAt` or `nextTouchAt` directly. The service recomputes
   full history so backdated records, deletion of the newest record, cadence,
   snoozing, and future-dated interactions remain correct.
6. **Preserve partial knowledge.** Carry `DatePrecision`; do not turn “2019”
   into January 1 or manufacture another unknown component. Use explicit
   `UNSPECIFIED` values where the historical answer is unknown.
7. **Preserve history.** Status and relationship changes re-type, settle, or
   archive records; they do not silently destroy them. Deletion stays explicit.
8. **Model editable types as taxonomy.** Add normal type/category defaults to
   `src/server/taxonomy/defaults.ts`; boot-time provisioning backfills existing
   owners. Use an enum only when code genuinely branches on all states.
9. **Protect offline data.** A table carrying private data must have a privacy
   where-fragment and participate in `countPrivateRows`; otherwise caching may
   remain enabled and place private data on disk. Locking and signing out must
   continue to wipe cached pages; writes must not be queued.
10. **Sweep polymorphic dependants.** `CustomFieldValue.entityId` is not a
    foreign key, so relevant delete paths must remove its values explicitly.

Any cross-owner exposure, private-row serialization, private count disclosure,
unsafe offline caching, invented date precision, or corrupted relationship or
interaction history is unacceptable even when tests happen to pass.

## Database and Migration Procedure

For any persistence change:

1. Inspect `prisma/schema.prisma`, existing migration history, all readers and
   writers, constraints, indexes, ownership paths, deletes, and documentation.
2. Update the Prisma schema. New top-level user-owned tables normally receive
   `ownerId`; justify deliberate exceptions scoped through a parent.
3. Generate a new migration with the repository workflow (`npm run db:migrate`).
   Never edit a migration that may already have shipped.
4. Read every line of generated SQL. Prisma diffs shape, not semantic intent.
   Verify renames, type conversions, nullability, defaults, foreign keys,
   indexes, and destructive operations.
5. Preserve live data: add columns safely, backfill or transform existing rows,
   verify the backfill, and only then remove obsolete storage. Put ordered work
   in a new migration that `prisma migrate deploy` can run unattended.
6. Add every new table to `TABLES` in `tests/integration/db.ts` so resets cannot
   leak state. Respect its `_test` database-name guard.
7. For private-capable data, add query filtering and private-row counting;
   review server-component payloads, aggregates, search, delete paths, and
   offline eligibility.
8. Add relevant cascade or explicit cleanup behavior, including manual custom
   field sweeps where applicable.
9. Test creation from an empty database (fresh schema) and migration from a
   representative prior schema with representative data (upgrade path). Verify
   values and precision after migration, not merely migration exit status.
10. Regenerate Prisma artifacts by the established command; never hand-edit
    generated client output. Update `docs/data-model.md`, migration/upgrade and
    operational guidance where relevant, and `CHANGELOG.md` when required.

Never treat generated SQL or a successful empty-schema migration as proof that
an upgrade preserves production data.

## Testing and CI Contract

Use Node 22. Inspect scripts and CI again if they change.

### Local baseline

Run each command separately when useful so outcomes are attributable:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .; build intentionally ignores lint
npm test            # vitest run: unit plus integration when configured
npm run build       # Next.js production/standalone build
```

`npm run lint` is mandatory even though the historical pre-push shorthand in
the docs lists typecheck, tests, and build: `next.config.ts` sets
`eslint.ignoreDuringBuilds`, while CI has an independent lint step.

### Unit and integration tests

- Add or update behavior-focused regression tests that fail without the change.
- Pure logic belongs in `src/lib/` and should receive deterministic unit tests.
- Server reads/writes require owner-scoping and privacy-lock cases where
  relevant. Date behavior requires account-timezone and boundary cases.
- Persistence changes should test preservation and cleanup behavior.
- Integration tests require `TEST_DATABASE_URL` pointing to a throwaway MariaDB
  database whose name ends in `_test`; reset truncates every table.
- Without that variable, integration suites skip. Report them as **skipped due
  to missing `TEST_DATABASE_URL`**, never as passing. CI emits JSON and runs
  `.github/scripts/assert-integration-ran.mjs` to ensure they actually ran.

### End-to-end and UI tests

For UI, navigation, privacy, offline, or user-flow changes, run:

```bash
npx playwright test
```

Playwright expects an already-running instance at `E2E_BASE_URL` (default
`http://127.0.0.1:3200`), uses one shared worker, runs first-run setup before
dependent mobile and desktop projects, and retains failure evidence. Validate
phone behavior, horizontal overflow, tappability, and the 16px input-font floor.
If the environment cannot supply the database, built server, or browser, report
the exact limitation; do not call E2E passing.

### CI parity

`.github/workflows/ci.yml` is part of the product contract. On pushes to main
and pull requests it verifies:

- Node 22 install, Prisma generation, typecheck, lint, and production build;
- unit and integration tests against MariaDB, plus an assertion that integration
  suites did not skip;
- migrations, a standalone production bundle, and the complete Playwright suite
  against an empty database; and
- Docker image build, clean-volume boot, database health, and restart with the
  persisted volume.

Reproduce a CI failure's actual command and environment when possible. Rerun
without code changes only with evidence of a transient/environmental failure.
Never claim “green” based solely on a subset of these jobs.

## Documentation Is Part of the Change

Update documentation in the same change and describe only verified behavior.
Inspect cross-links and known gaps so one page does not contradict another.

| Change | Required documentation review/update |
| --- | --- |
| User-visible behavior | `CHANGELOG.md` and relevant feature/operator guide |
| Schema, constraints, taxonomy, persistence | `docs/data-model.md`; migration/upgrade notes and changelog as applicable |
| Server action or write contract | `docs/server-actions.md` |
| Layering, data flow, subsystem, startup | `docs/architecture.md` |
| Lock, filtering, AI data flow, offline caching | `docs/privacy.md` |
| Environment, secrets, `/config`, external services | `docs/configuration.md` and applicable install/deployment/backup/upgrade/troubleshooting guide |
| Test command, prerequisite, suite, or CI behavior | `docs/testing.md`, `CONTRIBUTING.md`, and instruction files where needed |
| Operational/container behavior | `docs/deployment.md` plus install, backup, upgrade, or troubleshooting guidance as applicable |
| Implemented or removed capability | Relevant feature docs and `docs/README.md` known gaps |

Do not “promote” a known gap because a model, field, package, directory, or
partial UI exists. Conversely, when a gap becomes fully operational and tested,
update the known-gap inventory and all relevant operational guidance.

## Git, Conflicts, Commits, and Pull Requests

- Work on the provided task branch or a dedicated branch. Keep the diff focused.
- Fetch current `origin/main` when permitted, inspect divergence, and synchronize
  when appropriate before final validation. Do not rewrite shared history
  casually; if explicitly necessary, prefer `--force-with-lease`.
- Resolve text conflicts by understanding both intents and checking renamed
  APIs, schemas, migrations, tests, and callers. Never choose an entire “ours”
  or “theirs” version blindly. Regenerate lockfiles/generated metadata through
  their normal tools and rerun affected validation.
- Do not hand-merge opaque binaries. Establish the authoritative source,
  regenerate, or escalate.
- Before committing and reporting completion, inspect `git status`, the staged
  diff, and the complete diff against `origin/main` (or the known base).
- Exclude secrets, local configuration, databases, logs, caches, coverage,
  builds, archives, editor files, and Playwright reports/screenshots/videos/
  traces unless intentionally version-controlled. Investigate validation that
  dirties the tree, remove artifacts, and fix ignore/configuration where needed.
- Follow existing commit history: a short subject and a body explaining the
  decision and what it prevents. Name bugs discovered and how they were found.
- Use the pull-request template's applicable sections. Summarize purpose and
  decisions, privacy/persistence review, documentation, and exact validation
  outcomes; remove inapplicable checklist lines rather than checking blindly.
- Inspect an existing PR's base, head, diff, checks, and discussion before
  repairing it. Diagnose its HEAD and update it when permitted; otherwise make
  the safest repair branch/commit and explain how to apply it.
- Never call a PR “green,” “mergeable,” or “ready to merge” unless the claimed
  current head and all required checks were actually verified.

## Pre-Commit Checklist

- [ ] Requested behavior is implemented and the final diff is focused.
- [ ] Applicable `AGENTS.md`, `CLAUDE.md`, privacy, ownership, timezone,
  historical-data, taxonomy, caching, and data-integrity rules were reviewed.
- [ ] Implementations, call sites, tests, schema, migrations, documentation,
  configuration, scripts, and CI were inspected rather than assumed.
- [ ] Inputs are validated; every affected read/write is owner-scoped; every
  affected private query/action/count enforces the lock correctly.
- [ ] Date calculations use `UserContext.timezone`, partial precision is
  preserved, and contact activity writes use the service where applicable.
- [ ] Migration SQL was read; fresh-schema and upgrade-path behavior were
  validated where applicable; reset lists, deletes, and privacy safeguards were
  updated.
- [ ] Regression tests were added or updated without weakening coverage.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` ran;
  actual outcomes and skipped integration suites are recorded.
- [ ] Applicable Playwright and container/migration checks ran, or their exact
  environmental limitations are recorded.
- [ ] Every encountered error, including pre-existing errors, has a recorded
  investigation and root-cause resolution, or a substantiated escalation when
  safe repair genuinely exceeds scope.
- [ ] Documentation and changelog match verified current behavior and known gaps.
- [ ] `git status`, staged changes, and the full base diff contain no secrets,
  debug code, accidental generated/binary artifacts, or unrelated changes.
- [ ] Commit message explains the decision and what it prevents.

## Definition of Done and Completion Record

A task is done only when the requested result exists, relevant regression tests
pass, applicable CI-equivalent validation has run locally where reproducible,
privacy/persistence implications have been reviewed, documentation is current,
the branch/base relationship and final diff have been inspected, and no known
failure is hidden by suppression, skipping, weakened checks, or unsupported
language.

The final commit/PR/completion report must record:

- [ ] exactly what changed and why;
- [ ] every validation command actually run and its actual pass/fail result;
- [ ] which unit, integration, E2E, migration, build, or container suites were
  skipped or not run, and the exact environmental reason;
- [ ] every encountered pre-existing error, the evidence it predated the change,
  and its root-cause repair—or the explicit escalation details required above;
- [ ] privacy, ownership, timezone, migration, data-preservation, offline-cache,
  and documentation reviews that apply;
- [ ] remaining limitations and risks, with the safest next action; and
- [ ] final branch/commit identity and artifact-free status.

Do not say “all tests pass” if anything skipped or could not run. Do not use a
written caveat to excuse a feasible fix. Do not describe a feature as complete
until its executable behavior, persistence, privacy handling, tests,
configuration, and operational path have all been verified.
