# AGENTS.md — Repository Instructions for Coding Agents

This file defines repository-wide instructions for Codex and other coding agents working on Personal CRM.

`CLAUDE.md` is the detailed engineering handbook for this repository. **Read it before making changes.** Its architecture, privacy invariants, data-model rules, testing requirements, known gaps, and project-specific conventions are authoritative. This file supplements that context with agent workflow, Git, pull-request, CI, conflict-resolution, and completion requirements.

If this file and `CLAUDE.md` appear to conflict, preserve the stricter safety, privacy, data-integrity, and validation requirement and report the discrepancy.

## Core Principle: Leave the Repository Better, Green, and Explainable

Do not silently ignore an error you encounter. Compilation errors, type errors, lint failures, test failures, migration problems, privacy violations, build failures, and CI failures must be either fixed at their root cause or explicitly escalated when the fix genuinely exceeds the task's scope.

Never make a check pass by weakening the check. Do not delete or skip tests, reduce coverage requirements, add broad lint suppressions, cast away type errors, bypass privacy checks, or disable validation merely to obtain a green result.

## Start of Every Task

Before editing code:

1. Read `CLAUDE.md` and the documentation relevant to the task.
2. Inspect the current branch, `git status`, and recent history affecting the code you will modify.
3. Understand the existing implementation before replacing or refactoring it.
4. Inspect applicable tests and `.github/workflows/ci.yml` when the task can affect CI.
5. Keep the change focused. Do not perform unrelated cleanup unless it is required to resolve an error you actually encounter.

## Git and Branch Hygiene

Work on a dedicated branch unless the environment provides an existing task branch.

Before considering work complete:

- Fetch the latest `origin/main` when the environment permits.
- Determine whether the task branch has diverged from `origin/main`.
- Synchronize the branch when appropriate before final validation.
- Resolve ordinary text conflicts carefully, preserving the intent of both the current main branch and the proposed change.
- Never blindly select "ours" or "theirs" for an entire conflicted file without understanding both sides.
- After conflict resolution, rerun all validation relevant to the affected code.
- Inspect `git status` and the complete final diff against `origin/main`.

Do not rewrite shared branch history unless the task explicitly requires it and doing so is safe. If a rebase requires a force push, use the safest available mechanism such as `--force-with-lease` rather than an unconditional force push.

## Existing Pull Requests — Including PRs You Did Not Create

A pull request does **not** need to have been created by Codex or by the current agent for you to diagnose or repair its code.

When asked to fix an existing PR:

1. Inspect the PR's base and head state, changed files, checks, and relevant discussion.
2. Treat the PR's HEAD as the code state to diagnose.
3. Reproduce failing checks locally when possible.
4. Fix the root cause and validate the repair.
5. If permissions allow, update the existing PR branch.
6. If the environment cannot modify the original branch, do not stop merely because the PR was created elsewhere. Create a repair branch or repair commit from the PR state when permitted and clearly report how it should be applied.
7. If permissions or tooling genuinely prevent the repair, report the exact limitation rather than claiming the PR itself is unsupported.

Never claim that a PR is mergeable, green, or ready to merge unless that state has actually been verified.

## Merge Conflicts

For text conflicts:

- Read the surrounding code and both conflicting versions.
- Determine the behavioral intent of each side.
- Produce a coherent combined result rather than mechanically choosing one side.
- Check for renamed APIs, schema changes, migrations, tests, and call sites that may make one side stale.
- Run targeted tests immediately after resolution, then the broader required validation.

**A clean merge is not a verified merge.** The absence of a reported conflict says the text reconciled, not that the result is coherent, so rerun the full gate on the merged tree rather than only after your own edits. Each of the following merged without git reporting anything: two branches adding the same name to one import list, which `tsc` rejected as a redeclaration; two branches adding the same `let` to `public/sw.js`, which left a worker that no longer parsed; a test still driving a label `main` had renamed, in a file that merged perfectly; and a page given one new widget per side whose destructuring named only one of them. Conflict count is not a proxy for risk.

When both sides add something at the same point, the coherent result is usually both of them, in a defensible order — not a choice between them.

For conflicts involving migrations, dependency lockfiles, or generated metadata, understand how the file is produced before editing it. Regenerate when that is the repository's established workflow rather than hand-editing generated output blindly.

## Binary and Generated Files

Before every commit and before reporting completion, inspect `git status` and the full diff for unintended files.

Do not commit generated or runtime artifacts unless they are intentionally version-controlled by this repository. Examples include:

- database files or database snapshots
- caches
- logs
- coverage output
- compiled/build output
- temporary files
- test artifacts
- Playwright screenshots/videos/traces created by failed runs
- archives
- editor or operating-system metadata
- secrets or environment-specific configuration

If a test or build creates an untracked artifact:

1. determine why it was created;
2. remove it from the proposed change;
3. update `.gitignore` when appropriate; and
4. adjust the test/build configuration when necessary so normal validation does not dirty the repository.

Do not attempt to synthesize or manually merge the contents of an opaque binary conflict. Determine which version is authoritative, regenerate the file from source when possible, or escalate the binary conflict for review.

## Personal CRM Privacy and Data Integrity

The invariants in `CLAUDE.md` are mandatory, not suggestions. In particular:

- Treat every server action as a public POST endpoint: validate input, enforce the privacy lock, and scope by `ownerId`.
- Enforce privacy in database queries rather than hiding already-fetched data in components.
- Anchor date calculations to `UserContext.timezone`, never the server's timezone.
- Do not directly write `Contact.lastInteractionAt` or `nextTouchAt`; use the contact-activity service so derived state is recomputed from history.
- Preserve partial-date precision rather than inventing exact dates.
- Preserve historical information when statuses or relationship types change; deletion must remain explicit.
- New taxonomy values should normally be `TaxonomyTerm` rows rather than code enums unless program logic truly branches on them.
- Privacy-sensitive tables must participate in the repository's privacy-count/offline-caching safeguards described in `CLAUDE.md`.

A change that exposes another owner's data, leaks private rows into a server-component payload, incorrectly enables offline caching of private data, or corrupts historical relationship data is not acceptable even if tests happen to pass.

## Database and Migration Work

For Prisma schema changes:

1. Update `prisma/schema.prisma`.
2. Generate the migration using the repository's normal workflow.
3. **Read the generated SQL.** Do not assume Prisma understands the semantic intent of a rename or data transformation.
4. Backfill or transform existing data before destructive schema operations when required.
5. Never modify a migration that has already shipped; create a new migration.
6. Add new tables to the integration-test reset list described in `CLAUDE.md`.
7. Update privacy counting/filtering for tables carrying private data.
8. Test both a fresh schema and an upgrade path when the change affects persistence.
9. Update the appropriate documentation, and add a `CHANGELOG.d/` entry when the change is user-visible.

Never use a generated migration as evidence that a migration is safe. Inspect its effect on existing data.

## Testing and CI

GitHub Actions is part of the implementation contract. A change is not complete merely because the code looks correct locally.

The repository's pre-push baseline is a single command:

```bash
npm run verify
```

It chains typecheck, `eslint`, `npm run lint:sw`, `npm run changelog:check`, the unit and integration suites, and a production build — the same set CI runs. Run the individual commands when a failure needs isolating.

`npm run lint` matters because the Next.js build is configured not to catch lint failures. `npm run lint:sw` matters for a different reason: `eslint.config.mjs` ignores `public/sw.js` and the file is not TypeScript, so it is the service worker's only static check. A merge once left a duplicate `let` there; the worker stopped parsing, never installed, and offline reading failed silently until the end-to-end job caught it minutes later.

It parses with classic-script grammar rather than running `node --check`, which is not equivalent: `package.json` declares `"type": "module"`, so node would accept `import`, `export` and top-level `await` in that file, while both registrations of it omit `{ type: "module" }` and get a classic worker that rejects all three. A gate that accepts what the browser refuses is worse than none, because it is trusted.

One `tsc` error normally surfaces as three failed jobs rather than one, because `next build` typechecks and both the end-to-end and container jobs build first. Diagnose the typecheck failure before opening three investigations.

For UI changes, also run:

```bash
npx playwright test
```

when the environment can provide the required running instance.

Integration tests require `TEST_DATABASE_URL`; they may skip when it is absent. **A skipped integration suite must not be reported as passing integration tests.** Report the missing prerequisite explicitly. Never point destructive integration-test reset logic at a non-test database; the database name must satisfy the repository's `_test` safeguard.

When CI fails:

1. inspect the failing job and identify the first meaningful error;
2. reproduce the same command/environment locally when possible;
3. determine whether the failure is deterministic, flaky, environmental, or caused by the proposed change;
4. fix deterministic/root-cause failures;
5. rerun the affected check and relevant regression tests; and
6. only rerun a job without a code change when there is evidence the failure is transient or environmental.

Do not repeatedly rerun deterministic CI failures hoping for a green attempt.

## Testing Discipline

Tests should validate behavior, not implementation accidents.

When changing behavior:

- add or update tests that would fail without the intended fix;
- preserve existing regression coverage;
- include privacy/owner-scoping cases for server-side reads and writes when relevant;
- include timezone/date-boundary cases for date calculations when relevant;
- include migration/data-preservation coverage when practical for persistence changes;
- test mobile behavior for UI changes because mobile-first behavior is an explicit repository requirement.

Do not delete a failing test merely because the implementation changed. Determine whether the requirement changed; if so, update the test to express the new requirement and make that decision clear in the PR.

## Documentation

The documentation under `docs/` is part of the product. Keep it synchronized with behavior. Follow `CONTRIBUTING.md` and `CLAUDE.md` to determine which documentation a change affects.

User-visible changes get a new file in `CHANGELOG.d/`, never an edit to `CHANGELOG.md` itself. One file per change is what keeps two branches from competing for the top of `## [Unreleased]` — historically this repository's most frequent merge conflict, and on several branches its only one. `npm run changelog:release` folds them in at release time.

Do not document functionality that is not implemented. The known-gap section in `CLAUDE.md` exists specifically to prevent agents from assuming migrated models, dependencies, or configuration fields imply working features.

## Scope and Hard Stops

Fix errors you encounter when the repair is reasonably related to the code or validation being touched. If resolving a discovered problem would require a large unrelated redesign, destructive migration, security-policy decision, or substantial expansion of scope:

- stop before making speculative broad changes;
- report the problem completely;
- explain why it exceeds the current task; and
- identify the safest next action.

Do not silently continue past a known correctness, privacy, migration, or CI problem.

## Pre-Commit Review

Before committing, verify:

- [ ] The requested behavior is implemented.
- [ ] `CLAUDE.md` invariants applicable to the change were followed.
- [ ] Privacy and `ownerId` scoping were reviewed for every affected read/write path.
- [ ] Date calculations use the user's timezone where applicable.
- [ ] Prisma migrations were inspected for data loss when applicable.
- [ ] Relevant tests were added or updated.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes, with skipped integration tests reported accurately.
- [ ] `npm run build` passes.
- [ ] Playwright was run for applicable UI changes when the environment supports it.
- [ ] `git status` contains no unintended artifacts.
- [ ] The final diff contains no unrelated changes, secrets, debug code, or accidental generated files.
- [ ] Documentation and changelog updates were made when required.

## Definition of Done

Do not report a task as complete until:

- the requested behavior is implemented;
- relevant regression tests exist and pass;
- applicable CI-equivalent checks pass locally when reproducible;
- the final diff has been reviewed;
- no unintended generated/binary artifacts are included;
- persistence and privacy implications have been reviewed where applicable;
- the branch's relationship to current `main` has been considered;
- known limitations or checks that could not be performed are explicitly reported; and
- no known failure is being hidden behind a suppression, skipped test, weakened check, or unsupported claim.

A concise completion report should state what changed, what validation actually ran, its result, and any remaining limitation. Never say "all tests pass" when some suites were skipped or could not run.