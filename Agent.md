# Personal CRM — Agent Engineering Handbook

This file defines how coding agents must work in Personal CRM.

`AGENTS.md` contains repository-wide agent instructions. `CLAUDE.md` contains detailed architecture, privacy, data-model, and engineering guidance.

**Read both before modifying the repository.**

When instructions conflict, follow the requirement that provides the strongest protection for:

1. data privacy;
2. data integrity;
3. correctness;
4. test and CI reliability; and
5. preservation of existing user data.

---

# 1. Definition of Done

A task is **not complete because the requested code was written**.

A task is complete only when:

- the requested behavior is implemented;
- relevant regression tests exist;
- required documentation is updated;
- the branch has been checked against current `origin/main`;
- applicable CI-equivalent validation has passed;
- migrations have been reviewed for data preservation;
- privacy and owner-scoping implications have been reviewed;
- no unintended generated, binary, test, or runtime artifacts are included;
- the final diff has been reviewed; and
- any validation that could not be executed is explicitly reported.

Never report a branch as "ready", "green", "passing", or "complete" when a required check failed or was skipped.

---

# 2. Mandatory Start-of-Task Procedure

Before changing code:

```bash
git status
git branch --show-current
git fetch origin
git log --oneline --decorate -10
```

Then:

1. Read the current `AGENTS.md`.
2. Read the current `CLAUDE.md`.
3. Read relevant documentation.
4. Inspect `.github/workflows/ci.yml`.
5. Inspect `package.json` scripts.
6. Inspect the existing implementation and tests.
7. Compare the task branch with current `origin/main`.
8. Identify other recently changed code in the same subsystem.

Do not rely on instructions remembered from an earlier task.

**Repository instructions may have changed since the branch was created. Always use the versions from current `origin/main` as part of final synchronization and validation.**

---

# 3. Keep the Branch Current

Branch drift is a correctness risk.

Before final validation:

```bash
git fetch origin
```

Determine whether `origin/main` changed after the task branch was created.

If it did, integrate current `origin/main` into the task branch using the safest method supported by the environment.

After synchronization:

1. reread `AGENTS.md`;
2. reread relevant changed documentation/configuration;
3. inspect the resulting diff;
4. rerun validation on the **combined tree**.

Do not assume that two individually valid branches remain valid when combined.

A clean Git merge does not prove the resulting program is correct.

---

# 4. Concurrent and Overlapping Work

Before making schema, migration, shared-component, shared-query, shared-test, or documentation changes, inspect recent changes to the same area.

Pay particular attention to:

- `prisma/schema.prisma`;
- `prisma/migrations/`;
- shared server actions;
- shared components;
- shared query/service modules;
- `CHANGELOG.d/`;
- `CLAUDE.md`;
- `AGENTS.md`;
- CI configuration.

If another branch has changed the same concept, do not blindly recreate the older implementation.

Adapt the task to current `main`.

Never create a second migration that independently implements a schema change already present on current `main`.

---

# 5. Personal CRM Architecture

Personal CRM is a self-hosted relationship manager, not a sales CRM.

Primary stack:

- Next.js App Router
- React
- Prisma
- MariaDB
- Vitest
- Playwright
- Docker

General data flow:

```text
Server Component
    ↓
Server Query
    ↓
Prisma
    ↓
MariaDB

Client Form
    ↓
Server Action
    ↓
Service / Transaction
    ↓
Prisma
```

Keep pure, request-independent logic in `src/lib/`.

Server reads belong in `src/server/queries/`.

Writes enter through server actions and reusable transactional logic belongs in `src/server/services/`.

---

# 6. Privacy and Ownership Are Correctness Requirements

Every server action should be treated like a public POST endpoint.

For every affected read or write:

- resolve the authenticated owner;
- validate untrusted input server-side;
- scope access by `ownerId` or a verified owned parent;
- enforce privacy-lock behavior;
- never trust a client-supplied ID to establish ownership.

Privacy filtering belongs in database queries.

Do not fetch private rows and merely hide them in React components. Server-component payloads can expose fetched data.

Counts and aggregates can also disclose private information and must respect privacy rules.

For private-capable tables, verify:

- privacy query filtering;
- private-row counting;
- offline caching eligibility;
- search behavior;
- delete behavior.

A change that can expose another owner's data or private locked data is unacceptable even when tests pass.

---

# 7. Dates and Historical Data

Use `UserContext.timezone` for user-relative date calculations.

Do not rely on:

- host timezone;
- server-local timezone;
- `process.env.TZ`;
- implicit `new Date()` boundaries when account timezone matters.

Preserve partial historical dates.

Do not transform an unknown date such as:

```text
2019
```

into:

```text
2019-01-01
```

unless January 1 is actually known.

Preserve historical information when statuses, relationships, or classifications change.

Deletion must remain explicit.

---

# 8. Contact Activity

Do not directly modify:

```text
Contact.lastInteractionAt
Contact.nextTouchAt
```

Use the contact-activity service.

These values are derived from interaction history and must remain correct when interactions are:

- added;
- edited;
- deleted;
- backdated;
- future-dated;
- snoozed.

---

# 9. Taxonomy

User-editable categories and types should normally use `TaxonomyTerm`.

Do not introduce a code enum merely because a feature needs another selectable category.

Use an enum only when application logic genuinely branches on a finite set of states.

---

# 10. Database and Migration Rules

For every Prisma schema change:

1. inspect existing schema and migrations;
2. inspect all readers and writers;
3. update `prisma/schema.prisma`;
4. create a **new** migration;
5. inspect the generated SQL manually;
6. verify existing data is preserved;
7. verify ownership and privacy implications;
8. update integration-test reset behavior if a table is added;
9. test the migration path when practical;
10. update documentation.

Never modify a migration that may already have shipped.

Never assume Prisma understands that a schema change represents a rename.

For renames, explicitly preserve existing data.

Do not accept destructive migration SQL merely because Prisma generated it.

---

# 11. Changelog Rules

For user-visible changes:

**Do not edit `CHANGELOG.md` directly.**

Create a new entry under:

```text
CHANGELOG.d/
```

Follow the existing fragment format.

CI and `npm run verify` both fail a change that edits `CHANGELOG.md` without deleting the fragments it folded in, so this is a gate rather than a request. A release fold passes because it deletes fragments; a deliberate edit to already-released history passes with `[changelog]` in the commit subject.

`CHANGELOG.md` is assembled during the release process.

Before creating a changelog entry, inspect current `main` to ensure this convention has not changed.

---

# 12. CI Is Part of the Implementation Contract

The primary pre-push gate is:

```bash
npm run verify
```

Run it before reporting completion.

It covers the repository's fast CI-equivalent checks, including:

- TypeScript;
- ESLint;
- service-worker syntax;
- changelog validation;
- Vitest;
- production build.

When diagnosing failures, run the underlying command individually.

Examples:

```bash
npm run typecheck
npm run lint
npm run lint:sw
npm run changelog:check
npm test
npm run build
```

Do not weaken validation to make these commands pass.

---

# 13. Integration Tests

Integration tests require a MariaDB test database and:

```bash
TEST_DATABASE_URL
```

The database must satisfy the repository's `_test` safety requirement.

If integration tests skip because `TEST_DATABASE_URL` is unavailable, report:

> Integration tests were skipped because TEST_DATABASE_URL was unavailable.

Do **not** report:

> All tests passed.

A skipped suite is not a passing suite.

When the environment can provide MariaDB, configure it and run the integration tests rather than accepting the skip.

---

# 14. Playwright

For changes affecting UI, navigation, forms, privacy flows, offline behavior, or user workflows, run:

```bash
npx playwright test
```

when the environment supports it.

If Chromium is missing and installation is permitted, install the required Playwright browser rather than immediately abandoning E2E validation.

If E2E genuinely cannot run, report the exact missing prerequisite.

Never claim that an E2E test "passed" merely because the test code was written successfully.

---

# 15. Docker Validation

The Docker image is part of the product.

Changes affecting:

- dependencies;
- build configuration;
- startup;
- Prisma;
- migrations;
- database initialization;
- environment variables;
- standalone Next.js output;
- container files;
- `/config`;

should be considered capable of breaking container CI.

When practical, reproduce the relevant Docker build/boot behavior before completion.

---

# 16. CI Failure Procedure

When GitHub Actions fails, do not immediately rerun it.

First determine the first meaningful failure.

Use this order:

```text
typecheck
    ↓
lint / static validation
    ↓
unit/integration tests
    ↓
build
    ↓
E2E
    ↓
container
```

One TypeScript error may cause several CI jobs to fail because multiple jobs build the application.

Do not treat those as independent problems until the earliest failure is resolved.

For every CI failure:

1. inspect the failing job;
2. identify the first meaningful error;
3. reproduce its command locally when possible;
4. determine whether it is deterministic, flaky, environmental, or change-caused;
5. fix the root cause;
6. rerun the affected command;
7. rerun `npm run verify`;
8. push the repair;
9. re-check CI.

Only rerun unchanged code when there is evidence the failure was transient.

---

# 17. Existing Pull Requests

You may diagnose and repair a pull request regardless of who created it.

Do not refuse to work on a PR merely because:

- another Codex task created it;
- Claude created it;
- a human created it;
- another agent created it.

When repairing an existing PR:

1. inspect its HEAD;
2. inspect current `main`;
3. inspect CI;
4. inspect review comments;
5. inspect mergeability;
6. reproduce failures;
7. synchronize with current `main` when appropriate;
8. resolve conflicts;
9. run validation;
10. update the existing branch when permissions permit.

If the environment cannot update the original branch, explain the exact limitation and provide the safest repair path.

---

# 18. Conflict Resolution

Never blindly choose:

```text
ours
```

or:

```text
theirs
```

for an entire conflicted file.

Understand the intent of both sides.

For each conflict:

1. inspect surrounding code;
2. inspect both versions;
3. inspect related APIs and tests;
4. determine whether either side is stale;
5. construct the coherent combined result;
6. run targeted validation;
7. run the full required gate.

When both branches add valid behavior, the correct resolution may contain both changes.

---

# 19. Binary and Generated Files

Do not commit unintended:

- database files;
- caches;
- logs;
- build output;
- coverage output;
- Playwright screenshots;
- Playwright videos;
- Playwright traces;
- archives;
- temporary files;
- editor metadata;
- operating-system metadata;
- secrets;
- local environment configuration.

Before every commit:

```bash
git status
git diff
```

Before completion, inspect the complete diff against current `origin/main`.

Do not manually merge opaque binary files.

Regenerate generated files using the repository's established process.

---

# 20. Tests Must Protect Behavior

When fixing a bug, add a regression test when practical.

A good regression test:

- fails before the fix;
- passes after the fix;
- tests observable behavior;
- does not depend unnecessarily on implementation details.

Do not delete a failing test merely because it blocks the change.

Determine whether:

- the implementation is wrong; or
- the requirement intentionally changed.

If the requirement changed, update the test to represent the new requirement.

---

# 21. Documentation

Documentation is part of the implementation.

Update the relevant documentation when changing:

- schema;
- persistence;
- server actions;
- privacy;
- configuration;
- deployment;
- startup;
- testing;
- user-visible behavior;
- known feature gaps.

Document verified behavior only.

Do not describe a feature as implemented because a model, dependency, migration, setting, or partial UI exists.

---

# 22. Scope Control

Fix errors related to the task and validation being performed.

Do not turn a focused task into an unrelated architectural rewrite.

If a discovered issue requires:

- destructive migration;
- major redesign;
- security-policy decision;
- substantial unrelated work;
- unavailable infrastructure;

stop before making speculative broad changes.

Explain:

- the problem;
- the evidence;
- the risk;
- why it exceeds scope;
- the safest next action.

---

# 23. Mandatory Final Synchronization

Immediately before final validation:

```bash
git fetch origin
git status
```

Compare the task branch with current `origin/main`.

If `main` moved during the task, synchronize appropriately.

Then reread current repository instructions if they changed.

Run:

```bash
npm run verify
```

and applicable additional validation.

For UI/user-flow changes:

```bash
npx playwright test
```

when supported.

Then inspect:

```bash
git status
git diff origin/main...HEAD
```

Do not report completion from validation performed against an obsolete version of `main`.

---

# 24. Final Completion Report

Every completion report should state four things:

### Changes

What was actually changed.

### Validation

Exactly what was run.

Example:

```text
npm run verify — passed
npx playwright test — passed
```

### Skipped or unavailable validation

Example:

```text
Integration tests skipped because TEST_DATABASE_URL was unavailable.
Playwright not run because Chromium could not be installed in this environment.
```

### Remaining issues

State any known limitation, CI failure, conflict, or follow-up.

If none:

```text
No known remaining issues.
```

Never use vague statements such as:

```text
Tests look good.
Should pass CI.
Everything seems fine.
```

State what was actually verified.

---

# 25. Hard Rules

Never:

- expose another owner's data;
- bypass the privacy lock;
- hide private data only at the component layer;
- invent unknown historical dates;
- directly modify derived contact-activity fields;
- destroy existing data through an unsafe migration;
- edit a shipped migration;
- edit `CHANGELOG.md` for ordinary unreleased changes;
- weaken a test or validation rule merely to make CI green;
- call skipped tests passing;
- repeatedly rerun deterministic failures;
- blindly resolve conflicts with ours/theirs;
- commit unintended generated artifacts;
- assume a PR is safe because Git reports no merge conflict;
- assume a task branch still reflects current `main`;
- assume repository instructions are unchanged from the beginning of the task;
- claim CI is green without verifying CI.

The goal is not merely to produce code.

The goal is to produce a change that is **correct, private, data-safe, current with main, testable, reviewable, and capable of surviving the repository's complete CI pipeline.**
