import { describe, expect, it } from "vitest";
// Plain .mjs, shipped into the image as-is, so it carries no types of its own.
import { checkEnvironment, isValidTimezone } from "../../root/etc/s6-overlay/scripts/preflight.mjs";

/**
 * Boot-time configuration checks.
 *
 * The split that matters is error vs warning: an error stops the container, so
 * anything that only makes the app *odd* rather than *broken* must not be one.
 * Getting that wrong either hides a real misconfiguration or refuses to boot
 * over a typo in a field the app barely uses.
 */

const ok = { APP_URL: "https://crm.example.com", TZ: "America/New_York" };
const check = (env: Record<string, string | undefined>) =>
  checkEnvironment(env, { configWritable: true }) as { errors: string[]; warnings: string[] };

describe("isValidTimezone", () => {
  it("accepts real zones and rejects invented ones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("checkEnvironment", () => {
  it("passes a well-formed configuration", () => {
    const { errors, warnings } = check(ok);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("refuses to boot on an APP_URL that isn't an absolute http(s) URL", () => {
    // This one is a hard error because isSecureContext() reads the scheme to
    // decide the `secure` cookie flag — get it wrong and login silently fails.
    for (const value of ["crm.example.com", "ftp://crm.example.com", "/crm"]) {
      const { errors } = check({ ...ok, APP_URL: value });
      expect(errors.join(" ")).toMatch(/APP_URL/);
    }
  });

  it("warns, but still boots, on a plain-http APP_URL for a real host", () => {
    const { errors, warnings } = check({ ...ok, APP_URL: "http://crm.example.com" });
    expect(errors).toEqual([]);
    expect(warnings.join(" ")).toMatch(/not be marked secure/);
  });

  it("says nothing about http on localhost, where it is normal", () => {
    const { errors, warnings } = check({ ...ok, APP_URL: "http://localhost:3000" });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("warns about a trailing slash rather than refusing it", () => {
    const { errors, warnings } = check({ ...ok, APP_URL: "https://crm.example.com/" });
    expect(errors).toEqual([]);
    expect(warnings.join(" ")).toMatch(/trailing slash/);
  });

  it("warns when APP_URL is missing entirely", () => {
    const { errors, warnings } = check({ TZ: "UTC" });
    expect(errors).toEqual([]);
    expect(warnings.join(" ")).toMatch(/APP_URL is not set/);
  });

  it("warns about a bad TZ without refusing to boot", () => {
    // Accounts carry their own timezone, so process.env.TZ is only a fallback.
    // Refusing to start over a typo in it would be out of proportion.
    const { errors, warnings } = check({ ...ok, TZ: "Not/AZone" });
    expect(errors).toEqual([]);
    expect(warnings.join(" ")).toMatch(/TZ/);
  });

  it("rejects a DATABASE_URL that isn't mysql", () => {
    const { errors } = check({ ...ok, DATABASE_URL: "postgres://u:p@host:5432/db" });
    expect(errors.join(" ")).toMatch(/DATABASE_URL/);
  });

  it("accepts the mysql and mariadb schemes, and an empty value", () => {
    expect(check({ ...ok, DATABASE_URL: "mysql://u:p@host:3306/db" }).errors).toEqual([]);
    expect(check({ ...ok, DATABASE_URL: "mariadb://u:p@host:3306/db" }).errors).toEqual([]);
    expect(check({ ...ok, DATABASE_URL: "" }).errors).toEqual([]);
  });

  it("validates backup scheduling, retention, and free-space settings", () => {
    expect(
      check({ ...ok, BACKUP_TIME: "23:59", BACKUP_RETENTION_DAYS: "7", BACKUP_MIN_FREE_MB: "0" })
        .errors,
    ).toEqual([]);
    for (const env of [
      { BACKUP_TIME: "24:00" },
      { BACKUP_TIME: "2:00" },
      { BACKUP_RETENTION_DAYS: "0" },
      { BACKUP_RETENTION_DAYS: "1.5" },
      { BACKUP_MIN_FREE_MB: "-1" },
    ]) {
      expect(check({ ...ok, ...env }).errors.join(" ")).toMatch(/BACKUP_/);
    }
  });

  it("rejects a non-numeric PORT", () => {
    expect(check({ ...ok, PORT: "threethousand" }).errors.join(" ")).toMatch(/PORT/);
    expect(check({ ...ok, PORT: "3000" }).errors).toEqual([]);
  });

  it("refuses to boot when /config cannot be written", () => {
    const { errors } = checkEnvironment(ok, { configWritable: false }) as { errors: string[] };
    expect(errors.join(" ")).toMatch(/\/config is not writable/);
  });
});
