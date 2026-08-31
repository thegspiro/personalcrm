### The changelog convention is now enforced — 2026-08-30

*Schema: none*

#### Added
- **CI and `npm run verify` fail a change that edits `CHANGELOG.md` by hand.**
  Entries belong in `CHANGELOG.d/`, one file per change, so two branches cannot
  collide over the top of `## [Unreleased]`. A release fold passes, because it
  deletes the fragments it folds in; a deliberate edit to already-released
  history passes with `[changelog]` in the commit subject.

  Documenting the convention was not enough. Of the five pull requests opened in
  the hour after it shipped, all five edited `CHANGELOG.md` and none added a
  fragment — four of them from branches that already carried the instruction in
  `AGENTS.md`.
