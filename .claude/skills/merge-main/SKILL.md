---
name: merge-main
description: Bringing current main into a Personal CRM branch and validating the merged tree. Use when merging or rebasing main, when resolving conflicts, when a branch has fallen behind origin/main, or when CI fails on a branch that passed locally before the merge. Also use before final validation, since validation performed before integrating newer main does not count.
---

# Merging main

Authoritative text: **Agent.md sections 3, 18 and 23**, **AGENTS.md → Keep the
Branch Current** and **Conflict Resolution**, **CLAUDE.md → Merging main into a
branch**.

```bash
git fetch origin main
git merge origin/main
```

## A clean merge is not a verified merge

Git resolves text, not meaning. All of these merged with **no conflict
reported** and broke the build:

- Both sides added the same name to one import list → `tsc` redeclaration.
- Both sides added the same `let` to `public/sw.js` → the worker stopped
  parsing, never installed, and offline reading died silently. Nothing static
  catches this except `npm run lint:sw`.
- A test kept driving a label that main had renamed → the file merged perfectly.
- A page gained a widget on each side; the destructuring named only one.

So: **re-run the full gate on the merged tree**, not on your own edits.

```bash
npm run verify
npx playwright test    # for any UI, navigation, form, privacy or offline change
```

## Resolving a conflict

Never take `ours` or `theirs` for a whole file. For each conflict: read the
surrounding code, read both versions, read the related APIs and tests, work out
whether either side is stale, then construct the combined result. When both
branches added valid behaviour, the correct resolution usually contains both.

## Two places that conflict by construction

- **`CHANGELOG.md`** — never edit it by hand. One file per change in
  `CHANGELOG.d/`, which exists precisely so two branches cannot collide over
  the top of `## [Unreleased]`. `npm run changelog:guard` fails the build
  otherwise.
- **`prisma/migrations/`** — two branches each adding a migration is not a text
  conflict but may be a semantic one. Check that the timestamps order the way
  the data needs and that neither migration assumes a column the other dropped.

## After merging

If the merge changed `AGENTS.md`, `Agent.md`, `CLAUDE.md` or anything under
`docs/`, reread them. Instructions remembered from the start of the task may no
longer be current.
