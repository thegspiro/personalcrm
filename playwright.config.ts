import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against an already-running instance, so the same suite
 * can be pointed at `next start` locally or at the built container.
 * Override the target with E2E_BASE_URL.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3200";

/**
 * Point at an already-installed Chromium when one is provided. CI images often
 * ship a browser whose build number does not match this Playwright release, and
 * launching it directly is cheaper than downloading a second copy.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const chromium = executablePath ? { launchOptions: { executablePath } } : {};

const FIRST_RUN = /first-run\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The suite shares one instance and one account, so it must not self-race.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Runs first and creates the account every other project signs in with.
    {
      name: "first-run",
      testMatch: FIRST_RUN,
      use: { ...devices["Desktop Chrome"], browserName: "chromium", ...chromium },
    },
    // Mobile first: the primary flows are verified at phone width.
    {
      name: "mobile",
      testIgnore: FIRST_RUN,
      dependencies: ["first-run"],
      use: { ...devices["iPhone 13"], browserName: "chromium", ...chromium },
    },
    {
      name: "desktop",
      testIgnore: FIRST_RUN,
      dependencies: ["first-run"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...chromium,
      },
    },
  ],
});
