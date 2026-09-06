---
name: ship-it
description: The mandatory final procedure before reporting a Personal CRM task complete, opening a PR, or pushing a branch. Use when finishing a task, when about to say the work is done, when asked to push or open a pull request, when writing the completion report, or when deciding whether CI will pass. Also use when a suite skipped and you need to know how to report it.
---

# Before reporting completion

Authoritative text: **AGENTS.md → Mandatory Final Procedure** and **Completion
Report**, **Agent.md sections 23 and 24**. A task is not complete because the
code was written or a PR was opened.

## The sequence

1. `git fetch origin` — did `main` move during the task? If so, invoke the
   `merge-main` skill first. Validation performed against an obsolete `main` is
   not final validation.
2. Reread `AGENTS.md`, `Agent.md`, `CLAUDE.md` if the merge changed them.
3. Confirm a `CHANGELOG.d/` fragment exists for any user-visible change, and
   that nothing edited `CHANGELOG.md` by hand.
4. Run the gate:

```bash
npm run verify        # typecheck → lint → lint:sw → changelog → test → build
npx playwright test   # UI, navigation, forms, privacy, offline
```

5. Inspect the whole diff, not just the files you remember touching:

```bash
git status
git diff origin/main...HEAD
```

6. Confirm no stray artifacts, unrelated edits, secrets, debug code, `.env`,
   `data/`, `config/` or generated output is staged.

## Did the integration suites actually run?

They skip **silently** when `TEST_DATABASE_URL` is unset — `npm test` still
exits 0. Check before believing a green run:

```bash
grep -c TEST_DATABASE_URL .env && npx vitest run tests/integration/associates.test.ts
```

If they skipped, report *"integration tests were skipped because
TEST_DATABASE_URL was unavailable"* — never *"all tests passed"*. A skipped
suite is not a passing suite.

## Reading a red CI

One `tsc` error reads as three broken jobs: `next build` typechecks, and the
end-to-end and container jobs both build first. Treat three red ticks as one
bug until proven otherwise. Find the first meaningful failure before rerunning
anything; a deterministic failure does not become green on a retry.

Never weaken validation, skip a test, or relax an assertion to get green.

## The completion report

Four sections, no vague claims:

```text
### Changes
What was actually implemented or repaired.

### Validation
The exact commands and their results.
  npm run verify — passed
  npx playwright test — passed

### Skipped or unavailable validation
The exact checks that did not run, and why.
  Playwright not run: no app instance on 127.0.0.1:3200 in this environment.

### Remaining issues
Known CI failures, conflicts, limitations, follow-up work — or:
  No known remaining issues.
```

Not "should pass CI", not "looks good", not "probably fixed". Report only what
was verified.
