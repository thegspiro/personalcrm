# AGENTS.md — Personal CRM Agent Instructions

These instructions apply to all coding agents working in this repository.

## Instruction Hierarchy

Before making changes, read:

1. **`AGENTS.md`** — mandatory agent workflow and completion requirements.
2. **`Agent.md`** — detailed engineering and delivery procedures.
3. **`CLAUDE.md`** — architecture, privacy, data-model, testing, and project-specific engineering guidance.
4. Relevant documentation under **`docs/`**.
5. **`.github/workflows/ci.yml`** and relevant `package.json` scripts.

Do not rely on instructions remembered from an earlier task. Read the current repository versions.

If instructions conflict, preserve the stricter privacy, data-integrity, correctness, migration-safety, or validation requirement and report the discrepancy.

---

# Primary Rule

**A task is not complete because the requested code was written or a pull request was created.**

The task is complete only when the resulting branch has been synchronized appropriately with current `main`, reviewed, validated, and has no known deterministic failure being ignored.

Do not knowingly leave a PR red when the failure can reasonably be diagnosed and repaired.

Do not weaken validation merely to make a PR green.

---

# Start Every Task

Before editing:

1. Read `AGENTS.md`, `Agent.md`, and `CLAUDE.md`.
2. Read documentation relevant to the task.
3. Inspect:
   - current branch;
   - `git status`;
   - recent history;
   - current `origin/main`;
   - relevant implementation;
   - relevant tests;
   - `package.json`;
   - `.github/workflows/ci.yml`.
4. Fetch current `origin/main` when the environment permits.
5. Determine whether the task branch is already behind or diverged from `main`.
6. Search for recent changes to the same subsystem before implementing overlapping schema, migration, API, component, test, or documentation work.

Do not begin from assumptions about what the repository looked like when the task was originally requested.

---

# Keep the Branch Current

Branch drift is a correctness and CI risk.

Before final validation:

```bash
git fetch origin
git status
```

Compare the task branch with current `origin/main`.

If `main` changed during the task, synchronize the task branch when appropriate **before final validation**.

After synchronization:

1. reread `AGENTS.md`;
2. reread relevant portions of `Agent.md`, `CLAUDE.md`, and changed configuration;
3. resolve conflicts semantically;
4. inspect the resulting combined diff;
5. rerun required validation.

Never assume that two individually correct branches remain correct after they are combined.

**A clean Git merge is not a verified merge.**

---

# Existing Pull Requests

You may diagnose and repair an existing pull request regardless of who created it.

Do not refuse work merely because the PR was created by:

- another Codex task;
- another coding agent;
- Claude;
- a human contributor.

When asked to repair an existing PR:

1. inspect the PR HEAD;
2. inspect current `main`;
3. inspect changed files;
4. inspect CI/check results and logs;
5. inspect review comments;
6. inspect mergeability;
7. identify the first meaningful failure;
8. reproduce it locally when possible;
9. fix the root cause;
10. synchronize with current `main` when appropriate;
11. rerun validation;
12. update the existing PR branch when permissions permit.

If the environment cannot modify the original branch, explain the exact limitation and identify the safest repair path. Do not claim that the PR itself is unsupported.

---

# CI Failure Policy

When CI fails, **investigate before rerunning**.

For each failure:

1. inspect the failed job;
2. identify the first meaningful error;
3. reproduce the same command/environment locally when possible;
4. determine whether the failure is:
   - deterministic;
   - flaky;
   - environmental;
   - caused by branch drift;
   - caused by the proposed change;
5. repair the root cause when reasonably possible;
6. rerun the affected check;
7. rerun the repository validation gate;
8. push the correction;
9. re-check CI.

Only rerun unchanged code when there is evidence that the failure was transient or environmental.

One underlying error may make several CI jobs red. Diagnose the earliest meaningful failure before treating downstream failures as separate problems.

---

# Required Validation

The primary pre-push validation gate is:

```bash
npm run verify
```

Use individual commands to isolate failures when necessary:

```bash
npm run typecheck
npm run lint
npm run lint:sw
npm run changelog:check
npm test
npm run build
```

For applicable UI, navigation, privacy, offline, form, or user-flow changes, also run:

```bash
npx playwright test
```

when the environment supports the required application, database, and browser.

Do not report a task complete without stating exactly which validation actually ran.

---

# Integration Tests Must Actually Run

Integration tests require `TEST_DATABASE_URL` and a safe MariaDB test database.

If the environment can provide the database, configure it and run the integration tests.

If integration tests skip because `TEST_DATABASE_URL` is unavailable, report them as:

> Integration tests skipped because TEST_DATABASE_URL was unavailable.

Never describe skipped integration tests as passing.

---

# Playwright Must Actually Run

Writing or updating a Playwright test is not equivalent to running it.

If Chromium is missing and installation is permitted, install the required Playwright browser.

If Playwright cannot run, report the exact missing prerequisite.

Never claim E2E validation passed unless Playwright actually executed successfully.

---

# Conflict Resolution

Resolve conflicts by understanding both sides.

Never blindly choose an entire file using `ours` or `theirs`.

For every meaningful conflict:

1. understand the intent of both branches;
2. inspect surrounding implementation;
3. inspect related schemas, APIs, tests, and call sites;
4. identify stale assumptions;
5. construct a coherent combined result;
6. run targeted tests;
7. rerun the full applicable validation gate.

When both branches add valid behavior, the correct result may require preserving both changes.

---

# Concurrent Work and Duplicate Changes

Before creating a migration or making a significant shared-model change, inspect current `main` and recent work for an existing implementation of the same concept.

Pay particular attention to:

- `prisma/schema.prisma`;
- `prisma/migrations/`;
- shared server actions;
- shared services and queries;
- shared components;
- integration/E2E tests;
- `CHANGELOG.d/`;
- documentation.

Do not create a second migration for a schema change already implemented on current `main`.

Do not overwrite a newer implementation with an older task's assumptions.

Adapt the task to the current repository state.

---

# Personal CRM Safety Invariants

The detailed rules are in `Agent.md` and `CLAUDE.md`. The following are mandatory.

## Ownership and privacy

- Scope every server-side read and write by `ownerId` or a verified owned parent.
- Treat every server action as an untrusted public POST endpoint.
- Validate inputs server-side.
- Enforce privacy-lock behavior server-side.
- Filter private data in database queries, not merely in UI components.
- Treat counts and aggregates as potential disclosures.
- Review offline caching whenever private-capable data is introduced.

Cross-owner exposure or private-data leakage is a blocking correctness failure.

## Dates

Use `UserContext.timezone` for user-relative date calculations.

Preserve partial-date precision. Never invent unknown month/day values.

## Contact activity

Do not directly write:

```text
Contact.lastInteractionAt
Contact.nextTouchAt
```

Use the established contact-activity service.

## Taxonomy

Prefer `TaxonomyTerm` for user-editable categories and types.

Use code enums only for genuinely finite application states on which program logic branches.

---

# Database and Migration Safety

For persistence changes:

1. inspect existing schema and migration history;
2. inspect all relevant readers and writers;
3. update the Prisma schema;
4. create a new migration;
5. inspect the generated SQL manually;
6. verify existing data is preserved;
7. review ownership/privacy implications;
8. update integration reset behavior for new tables;
9. test fresh-schema and upgrade behavior when applicable;
10. update documentation.

Never modify a migration that may already have shipped.

Never accept destructive migration behavior merely because Prisma generated it.

Treat renames as data-preservation operations, not drop-and-create operations.

---

# Changelog

For ordinary user-visible unreleased changes:

**Do not edit `CHANGELOG.md` directly.**

Create the appropriate entry under:

```text
CHANGELOG.d/
```

Follow the current repository fragment convention.

Always inspect current instructions before doing changelog work because repository release conventions may evolve.

This is enforced rather than requested. CI and `npm run verify` both fail a change that edits `CHANGELOG.md` without deleting the fragments it folded in, so a hand edit cannot reach `main` whether or not this file was read. A release fold passes because it deletes fragments; a deliberate edit to already-released history passes with `[changelog]` in the commit subject.

---

# Generated, Binary, and Runtime Artifacts

Before committing and before completion, inspect:

```bash
git status
git diff
```

Do not unintentionally commit:

- databases;
- logs;
- caches;
- build output;
- coverage output;
- Playwright screenshots/videos/traces;
- test artifacts;
- temporary files;
- archives;
- editor/OS metadata;
- secrets;
- local environment files.

Do not manually merge opaque binary conflicts.

Regenerate generated files using the repository's established process.

---

# Testing Discipline

When behavior changes, add or update regression tests when practical.

Tests should verify behavior, not implementation accidents.

Do not:

- delete a failing test merely to obtain green CI;
- skip a test to hide a regression;
- weaken assertions without a legitimate requirement change;
- lower coverage requirements to make a task pass;
- add broad lint/type suppressions;
- cast away errors instead of fixing them.

If an existing test is no longer correct because the requirement intentionally changed, update the test to express the new requirement.

---

# Scope

Keep changes focused.

Fix discovered errors when the repair is reasonably related to the task or validation being performed.

If a discovered issue requires a major unrelated redesign, destructive migration, security-policy decision, unavailable infrastructure, or substantial scope expansion:

1. stop speculative broad changes;
2. explain the problem;
3. provide evidence;
4. explain the risk;
5. explain why the safe repair exceeds scope;
6. identify the safest next action.

Do not silently proceed past a known privacy, data-integrity, migration, correctness, or CI problem.

---

# Mandatory Final Procedure

Immediately before reporting completion:

1. Fetch current `origin/main`.
2. Determine whether `main` moved during the task.
3. Synchronize when appropriate.
4. Reread current repository instructions if synchronization changed them.
5. Resolve any conflicts semantically.
6. Inspect the complete resulting diff.
7. Run:

```bash
npm run verify
```

8. Run applicable additional validation, including Playwright when supported.
9. Inspect:

```bash
git status
git diff origin/main...HEAD
```

10. Confirm no unintended artifacts, unrelated changes, secrets, debug code, or obsolete assumptions remain.

Validation performed before integrating newer `main` is not sufficient final validation.

---

# Completion Report

Every completion report must clearly state:

**Changes**
- What was implemented or repaired.

**Validation**
- Exact commands that ran and their results.

**Unavailable or skipped validation**
- Exact checks that did not run and why.

**Remaining issues**
- Known CI failures, conflicts, limitations, or follow-up work.

Do not use vague claims such as:

- "all tests pass" when suites skipped;
- "should pass CI";
- "looks good";
- "probably fixed";
- "ready to merge" without verifying the relevant state.

Report only what was actually verified.

---

# Hard Stops

Never knowingly:

- expose another owner's data;
- leak locked/private data;
- bypass ownership or privacy validation;
- invent unknown historical dates;
- directly modify derived contact-activity fields;
- destroy existing user data through an unsafe migration;
- edit a shipped migration;
- weaken validation to obtain green CI;
- describe skipped tests as passing;
- repeatedly rerun deterministic failures hoping for green;
- blindly resolve conflicts using `ours` or `theirs`;
- commit unintended generated or runtime artifacts;
- assume a clean merge is a correct merge;
- assume a task branch reflects current `main`;
- assume instructions from the start of the task are still current;
- claim CI is green without verifying it.

## Final Standard

The objective is not simply to generate code or open a pull request.

**Leave the repository correct, private, data-safe, current with `main`, validated as completely as the environment permits, and with no known repairable CI failure hidden or ignored.**
