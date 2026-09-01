/**
 * Loads .env for the test run so integration tests can find TEST_DATABASE_URL
 * without every developer exporting it by hand.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

/**
 * A deterministic AUTH_SECRET for the suite.
 *
 * Anything that encrypts at rest derives its key from this and throws without
 * it, so every test touching a stored API key or channel credential needs one.
 * Set here rather than in each test: it was set here only in `.env`, which CI
 * does not have, so the suite passed locally and failed there — the worst
 * shape for this, since the machine that runs it least often is the one that
 * tells the truth.
 *
 * Never falls back to this in the app: `secrets.ts` reads `process.env`
 * directly and the container generates a real one into `/config/secrets.json`.
 */
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "test-only-secret-not-used-outside-the-suite";
}
