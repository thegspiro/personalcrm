/**
 * Fail the build when the integration suites did not actually run.
 *
 * They skip themselves when TEST_DATABASE_URL is absent — deliberately, so a
 * developer without a spare database is not blocked. In CI that same behaviour
 * would turn a broken service container into a green tick: 78 tests silently
 * not run, and nothing on the summary saying so.
 *
 * Reads the JSON reporter output written by `vitest run --reporter=json`.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "vitest-results.json";
const report = JSON.parse(readFileSync(file, "utf8"));

const integration = report.testResults.filter((suite) =>
  suite.name.replaceAll("\\", "/").includes("tests/integration/"),
);

if (integration.length === 0) {
  console.error("No integration suites were collected at all — check the vitest include globs.");
  process.exit(1);
}

const cases = integration.flatMap((suite) => suite.assertionResults);
const skipped = cases.filter((test) => test.status !== "passed" && test.status !== "failed");

if (skipped.length > 0) {
  console.error(
    `${skipped.length} of ${cases.length} integration tests did not run.\n` +
      "TEST_DATABASE_URL is missing or the database is unreachable, so the suites " +
      "skipped themselves. That is a red build, not a green one.",
  );
  for (const test of skipped.slice(0, 5)) console.error(`  · ${test.fullName} [${test.status}]`);
  process.exit(1);
}

console.log(`All ${cases.length} integration tests ran against the service database.`);
