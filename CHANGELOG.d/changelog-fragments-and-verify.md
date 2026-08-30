### One command to verify, one file per changelog entry — 2026-08-30

*Schema: none*

#### Added
- **`npm run verify`** runs typecheck, lint, the service-worker parse check, the
  changelog-entry check, the unit and integration suites, and a production build
  — the same set CI runs, so the pre-push gate is one command rather than a
  four-line checklist.
- **`npm run lint:sw`** parses `public/sw.js`. ESLint ignores that file and it is
  not TypeScript, so it previously had no static check at all: a merge left two
  `let cachingEnabled` declarations in it, and the resulting `SyntaxError` meant
  the worker never installed and offline reading stopped working, with the
  eight-minute end-to-end job the first thing to notice.

#### Changed
- **Changelog entries now live one-per-file in `CHANGELOG.d/`** until
  `npm run changelog:release` folds them in. Every change wanted the top of
  `## [Unreleased]`, so two branches editing `CHANGELOG.md` conflicted by
  construction — it was this repository's most frequent merge conflict and on
  several branches its only one. Two new files cannot collide.
