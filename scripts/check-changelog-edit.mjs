#!/usr/bin/env node
/**
 * Refuse a change that writes into CHANGELOG.md by hand.
 *
 * Entries belong in CHANGELOG.d/, one file per change, so that two branches
 * cannot collide over the top of `## [Unreleased]`. That convention is written
 * down in CONTRIBUTING.md, CLAUDE.md, Agent.md and AGENTS.md — and it was
 * ignored by five of the five pull requests opened in the hour after it
 * shipped, four of which had the instruction in their own branch. An
 * instruction nothing enforces is not a control, so this enforces it.
 *
 * A release is the one legitimate edit: `npm run changelog:release` folds the
 * fragments in and deletes them, so a change that removes fragments is allowed
 * to touch the file. For the rare deliberate edit that is neither — fixing a
 * typo in already-released history — put [changelog] in the commit subject.
 *
 *   node scripts/check-changelog-edit.mjs [base-ref]
 */

import { execFileSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let range;
try {
  range = `${git("merge-base", base, "HEAD")}..HEAD`;
} catch {
  console.error(`Could not find a merge base with ${base}; skipping the changelog check.`);
  process.exit(0);
}

const changed = git("diff", "--name-status", range)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const touchedChangelog = changed.some(([status, path]) => path === "CHANGELOG.md" && status !== "D");
if (!touchedChangelog) {
  console.log("CHANGELOG.md untouched.");
  process.exit(0);
}

const foldedARelease = changed.some(([status, path]) => status === "D" && path.startsWith("CHANGELOG.d/"));
if (foldedARelease) {
  console.log("CHANGELOG.md edited as part of a release fold.");
  process.exit(0);
}

const deliberate = git("log", "--format=%s", range).split("\n").some((s) => s.includes("[changelog]"));
if (deliberate) {
  console.log("CHANGELOG.md edited deliberately ([changelog] in a commit subject).");
  process.exit(0);
}

console.error(`CHANGELOG.md was edited by hand.

Entries go in CHANGELOG.d/ — one file per change — and are folded into
CHANGELOG.md at release by \`npm run changelog:release\`. That is what stops two
branches conflicting over the top of ## [Unreleased], which was this
repository's most common merge conflict.

  1. Revert your change to CHANGELOG.md.
  2. Put the entry in CHANGELOG.d/<slug>.md instead.
  3. Run \`npm run changelog:check\` to validate it.

See CHANGELOG.d/README.md for the shape an entry takes.

If this really is a release fold, it should have deleted the fragments it
folded in. If it is a deliberate edit to already-released history, put
[changelog] in the commit subject.`);
process.exit(1);
