/**
 * Boot-time checks on what the operator supplied.
 *
 * Runs before MariaDB, so a misconfiguration is a clear line in the log rather
 * than a puzzle three services later. The distinction that matters here:
 *
 *  - An **error** means the app cannot work as configured, and the container
 *    stops rather than serving something subtly broken. A wrong APP_URL is the
 *    real one: `isSecureContext()` in src/server/auth/session.ts decides the
 *    `secure` cookie flag from its scheme, so behind HTTPS with an http:// URL
 *    you get a login form that never signs anyone in.
 *  - A **warning** means something is probably not what was intended, but the
 *    app works. TZ is only the fallback for accounts that have not set their
 *    own, so a bad one is worth saying and not worth refusing to boot over.
 *
 * The checks are pure and take an env object so they can be unit-tested without
 * a container; only `main()` touches the filesystem or exits.
 */

import { accessSync, constants } from "node:fs";

/** Zones the platform actually knows. Anything else silently shifts dates. */
export function isValidTimezone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Hosts where plain http is normal rather than a reverse-proxy mistake. */
function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ configWritable?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkEnvironment(env, options = {}) {
  const errors = [];
  const warnings = [];

  // --- TZ ------------------------------------------------------------------
  const tz = env.TZ?.trim();
  if (tz && !isValidTimezone(tz)) {
    warnings.push(
      `TZ="${tz}" is not a timezone this system knows. Falling back to UTC for anything ` +
        `not set per-account. Use a zone name like America/New_York.`,
    );
  }

  // --- APP_URL -------------------------------------------------------------
  const appUrl = env.APP_URL?.trim();
  if (appUrl) {
    let parsed;
    try {
      parsed = new URL(appUrl);
    } catch {
      parsed = null;
    }

    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      errors.push(
        `APP_URL="${appUrl}" is not an absolute http(s) URL. Set it to the address you ` +
          `open the app on, e.g. https://crm.example.com.`,
      );
    } else {
      // No trailing-slash check: nothing concatenates onto this value. The one
      // reader is `secureCookies()`, which asks whether it starts with https://.
      if (parsed.protocol === "http:" && !isLocalHost(parsed.hostname)) {
        warnings.push(
          `APP_URL="${appUrl}" is http. If you actually reach the app over HTTPS — behind ` +
            `a reverse proxy, say — set the https:// URL instead, or session cookies will ` +
            `not be marked secure and signing in may not stick.`,
        );
      }
    }
  } else {
    warnings.push(
      "APP_URL is not set, so session cookies will not be marked secure. Set it to your " +
        "external URL. Nothing else reads it — reminders carry no links.",
    );
  }

  // --- DATABASE_URL --------------------------------------------------------
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    let parsed;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:")) {
      errors.push(
        "DATABASE_URL is set but is not a mysql:// URL. Leave it empty to use the bundled " +
          "MariaDB, or set something like mysql://user:password@host:3306/personalcrm.",
      );
    }
  }

  // --- PORT ----------------------------------------------------------------
  const port = env.PORT?.trim();
  if (port && !/^\d+$/.test(port)) {
    errors.push(`PORT="${port}" is not a number.`);
  }

  // --- /config -------------------------------------------------------------
  if (options.configWritable === false) {
    errors.push(
      "/config is not writable. The database, uploads and secrets.json all live there — " +
        "check the volume mapping and that PUID/PGID own the folder on the host.",
    );
  }

  return { errors, warnings };
}

function main() {
  let configWritable = true;
  try {
    accessSync("/config", constants.W_OK);
  } catch {
    configWritable = false;
  }

  const { errors, warnings } = checkEnvironment(process.env, { configWritable });

  for (const warning of warnings) console.log(`[init-preflight] warning: ${warning}`);
  for (const error of errors) console.error(`[init-preflight] error: ${error}`);

  if (errors.length > 0) {
    console.error(
      `[init-preflight] refusing to start with ${errors.length} configuration ` +
        `${errors.length === 1 ? "error" : "errors"}`,
    );
    process.exit(1);
  }

  console.log("[init-preflight] configuration looks usable");
}

// Only when run as a script, so importing this from a test is side-effect free.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
