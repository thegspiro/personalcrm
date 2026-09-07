import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { ensureSignedIn } from "./helpers";

/**
 * The content security policy, proved against a running app.
 *
 * A policy that blocks something the app needs fails *silently* — the script
 * simply never runs — so the assertion that matters is not the header's shape
 * but the absence of violations while the app is actually used. The unit tests
 * cover the shape.
 */

const VIOLATION = /content security policy|refused to (execute|load|apply|connect)/i;

function collectViolations(page: Page): string[] {
  const found: string[] = [];
  const record = (message: ConsoleMessage) => {
    const text = message.text();
    if (VIOLATION.test(text)) found.push(text);
  };
  page.on("console", record);
  page.on("pageerror", (error) => {
    if (VIOLATION.test(error.message)) found.push(error.message);
  });
  return found;
}

test("every document carries an enforcing policy with a nonce", async ({ page }) => {
  await ensureSignedIn(page);
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"];

  expect(policy, "the enforcing header, not report-only").toBeTruthy();
  expect(policy).toMatch(/script-src [^;]*'nonce-[a-f0-9]+'/);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("frame-ancestors 'none'");
});

test("the nonce is fresh on every request", async ({ page }) => {
  await ensureSignedIn(page);
  const first = (await page.goto("/"))?.headers()["content-security-policy"];
  const second = (await page.goto("/people"))?.headers()["content-security-policy"];
  expect(first).not.toBe(second);
});

test("the app runs under the policy without a single violation", async ({ page }) => {
  const violations = collectViolations(page);
  await ensureSignedIn(page);

  // The routes that carry the app's own inline script, its bundles, its
  // service worker and its images.
  for (const route of ["/", "/people", "/timeline", "/calendar", "/settings"]) {
    await page.goto(route);
    await expect(page.getByRole("navigation").first()).toBeVisible();
  }

  expect(violations, violations.join("\n")).toEqual([]);
});

test("the theme script still runs, which is what proves the nonce reached it", async ({
  page,
}) => {
  // next-themes sets the class from an inline script. If the nonce were not
  // plumbed through, this is exactly what would silently stop working while
  // every visible assertion above still passed.
  const violations = collectViolations(page);
  await ensureSignedIn(page);
  await page.goto("/");

  const themed = await page.evaluate(() => {
    const root = document.documentElement;
    return root.classList.contains("dark") || root.classList.contains("light");
  });

  expect(themed, "next-themes applied a theme class").toBe(true);
  expect(violations, violations.join("\n")).toEqual([]);
});
