---
name: steward
description: How to drive an open pull request in Personal CRM — responding to CI failures, review findings and merge conflicts on a PR you opened or were asked to get mergeable. Use when a CI job fails on your PR, when a review bot or a person leaves findings, when the branch falls behind main, when checking back on a PR you are watching, or when deciding whether a PR is actually done.
---

# Driving a pull request here

`ship-it` is the gate before you open one. This is the loop after.

The generic harness rules already cover the shape of that loop — fix red CI,
resolve conflicts, answer reviewers, never disable a test to get green. What
follows is only what is specific to *this* repository, and the one lesson it
learned the hard way.

## A green CI is not a review

Pull request #106 merged ninety minutes after an automated review posted seven
findings on it. Not one had been addressed. Every one was real, and one was an
accessibility regression in the **default** configuration — the results of an
address lookup could not be reached from a keyboard at all. All four CI jobs
were green the entire time.

That is not a failure of diligence, it is a fact about what CI measures. A type
checker and a test suite answer "does this do what its tests say". They have
nothing to say about whether a list can be reached by a keyboard, whether two
settings reads can disagree, or whether a hostname has a second valid spelling
that walks past a gate. Those are exactly the seven.

So: **a review bot's finding is a bug report.** Verify it and fix it, or reply
saying precisely why it does not apply, and resolve the thread. Both are
decisions. Merging past it unread is not.

`.github/workflows/review-findings.yml` now enforces this — an unresolved
review thread from a bot fails the "Review findings addressed" check. Resolving
the thread is what turns it green. It cannot judge whether a finding is
correct; it only insists that somebody looked.

## Before you say a PR is verified

One `tsc` error reads as three broken jobs. `next build` typechecks, and the
end-to-end and container jobs both build first, so a single missing import
fails Typecheck, End-to-end and Container build together. Treat three red ticks
as one bug until proven otherwise.

**Do not edit source while an end-to-end run is building.** The runner builds
the tree as it stands when it starts; a file changed after that is not in the
bundle under test, and reporting the pass as if it were is a claim about code
that was never exercised. Freeze the tree, then run. This is written down
because it was got wrong three times in a row on one branch.

The integration suites skip **silently** when `TEST_DATABASE_URL` is unset and
`npm test` still exits 0 — `ship-it` has the check for that. If they skipped,
say so; never "all tests passed".

## Changelog

Fragments in `CHANGELOG.d/`, one file per change, never `CHANGELOG.md` itself —
`changelog:guard` fails the build otherwise. A test-only or tooling-only change
needs no fragment at all: the guard only refuses hand-edits, and a fragment
about tests is noise in release notes somebody reads to decide whether to
upgrade.

## When a fix touches the end-to-end suite

`AppSetting` is stored per **installation**, not per account, and the three
Playwright projects share one database and one account serially. A spec that
switches something on there changes what every later spec sees. Switch it back
off in a final **test** rather than an `afterAll` hook, so a failed restore is
reported in the file that caused it instead of surfacing as an unrelated spec
failing for reasons of its own. `tests/e2e/address-typeahead.spec.ts` is the
worked example.

A stray private contact is the same trap: it switches offline caching off
account-wide and fails a later project for no visible reason.

## What "done" means

Green on the current head, no merge conflict, and every review thread either
fixed or answered and resolved. A PR whose checks are green while a finding sits
unread is not done — it is the thing #106 did.
