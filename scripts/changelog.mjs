#!/usr/bin/env node
/**
 * Changelog entries live one-per-file in `CHANGELOG.d/` until a release folds
 * them into `CHANGELOG.md`.
 *
 * The reason is merge behaviour, not tidiness. Every change wants the top of
 * `## [Unreleased]`, so two branches editing `CHANGELOG.md` collide by
 * construction — it was the single most common conflict in this repository,
 * and on several branches the *only* one. A new file per change cannot
 * conflict with another new file. Folding them together happens once, by one
 * person, at release, where there is nothing to race.
 *
 *   node scripts/changelog.mjs          # what is pending
 *   node scripts/changelog.mjs check    # validate every fragment (CI runs this)
 *   node scripts/changelog.mjs release  # fold into CHANGELOG.md, remove fragments
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const DIR = "CHANGELOG.d";
const FILE = "CHANGELOG.md";
const UNRELEASED = "## [Unreleased]";

/** Every fragment, newest first, so the assembled section reads like the file. */
function fragments() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => ({ name, body: readFileSync(join(DIR, name), "utf8").trim() }))
    .map((entry) => ({ ...entry, date: (entry.body.match(/—\s*(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? "" }))
    .sort((a, b) => (b.date === a.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date)));
}

/**
 * A fragment is a section of the changelog, so it has to be shaped like one.
 * Catching that here is the difference between a bad heading being noticed in
 * seconds and it being noticed at release, when whoever is releasing has no
 * idea what the entry was meant to say.
 */
function problems({ name, body }) {
  const found = [];
  if (!body.startsWith("### ")) found.push("must begin with a `### Title — YYYY-MM-DD` heading");
  if (!/—\s*\d{4}-\d{2}-\d{2}/.test(body.split("\n")[0] ?? "")) found.push("heading needs an em-dashed ISO date");
  if (!/^\*Schema:/m.test(body)) found.push("needs a `*Schema: …*` line naming its migrations, or `none`");
  if (!/^-\s|\n-\s/.test(body)) found.push("needs at least one bullet");
  return found.map((problem) => `${name}: ${problem}`);
}

const command = process.argv[2] ?? "list";
const entries = fragments();

if (command === "list") {
  if (entries.length === 0) console.log("No pending changelog entries.");
  else {
    console.log(`${entries.length} pending changelog ${entries.length === 1 ? "entry" : "entries"}:\n`);
    for (const entry of entries) console.log(`  ${entry.name}\n    ${entry.body.split("\n")[0]}`);
  }
} else if (command === "check") {
  const found = entries.flatMap(problems);
  if (found.length > 0) {
    console.error("Malformed changelog entries:\n");
    for (const problem of found) console.error(`  ${problem}`);
    console.error(`\nSee ${DIR}/README.md for the shape one takes.`);
    process.exit(1);
  }
  console.log(`${entries.length} changelog ${entries.length === 1 ? "entry" : "entries"} OK.`);
} else if (command === "release") {
  const found = entries.flatMap(problems);
  if (found.length > 0) {
    console.error("Refusing to release malformed entries:\n");
    for (const problem of found) console.error(`  ${problem}`);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.log("Nothing to fold in.");
    process.exit(0);
  }

  const changelog = readFileSync(FILE, "utf8");
  const start = changelog.indexOf(UNRELEASED);
  if (start === -1) throw new Error(`${FILE} has no ${UNRELEASED} heading`);

  // Insert below any HTML comment sitting under the heading, so the note
  // telling the next person not to edit this file by hand stays where they
  // will see it rather than being pushed down by every release.
  const rest = changelog.slice(start + UNRELEASED.length);
  const note = rest.match(/^\s*<!--[\s\S]*?-->/);
  const after = start + UNRELEASED.length + (note ? note[0].length : 0);

  const assembled = entries.map((entry) => entry.body).join("\n\n");
  writeFileSync(FILE, `${changelog.slice(0, after)}\n\n${assembled}\n${changelog.slice(after)}`);
  for (const entry of entries) unlinkSync(join(DIR, entry.name));
  console.log(`Folded ${entries.length} ${entries.length === 1 ? "entry" : "entries"} into ${FILE}.`);
} else {
  console.error(`Unknown command "${command}". Use: list | check | release`);
  process.exit(1);
}
