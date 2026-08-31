#!/usr/bin/env node
/**
 * Parse the service worker the way a browser will.
 *
 * `node --check` is not equivalent here. `package.json` declares
 * `"type": "module"`, so node parses `public/sw.js` with module grammar and
 * accepts `import`, `export` and top-level `await` — none of which a *classic*
 * worker can run, and both registrations of this file (the app's and the
 * end-to-end suite's) omit `{ type: "module" }`. A check that accepts syntax
 * the browser rejects is worse than no check, because it is trusted.
 *
 * `vm.Script` compiles with classic-script grammar, which is the grammar the
 * worker actually gets. It only parses: nothing here is executed.
 */

import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const FILE = "public/sw.js";

try {
  new Script(readFileSync(FILE, "utf8"), { filename: FILE });
} catch (error) {
  console.error(`${FILE} does not parse as a classic script:\n`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error(`\nA browser registers this file with no { type: "module" }, so`);
  console.error(`module-only syntax fails there even where node would accept it.`);
  process.exit(1);
}

console.log(`${FILE} parses as a classic script.`);
