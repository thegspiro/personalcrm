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
 * One setting, as the service that reads it will see it.
 *
 * `env.X?.trim()` behind a truthiness guard reads a whitespace-only value as
 * absent and validates nothing — and no consumer agrees. The shell's `:-`
 * default fires on empty and never on blank, so `BACKUP_TIME="   "` reaches
 * the scheduler intact, trims to nothing *there*, and is refused: s6 restarts
 * that service for as long as the container lives, while preflight has
 * already announced the configuration usable. The two other backup settings
 * fail the same way in `backup-now`.
 *
 * So `configured` is the raw value being non-empty, matching `:-` and `-n`
 * rather than a trim, and `value` is what the consumer validates: trimmed for
 * the settings whose scripts trim them, raw for those that do not. `raw` is
 * what the message quotes, so a blank one is visible as blank.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} key
 * @param {{ trimmed?: boolean }} [options]
 */
function setting(env, key, options = {}) {
  const raw = env[key];
  if (typeof raw !== "string" || raw === "")
    return { configured: false, value: "", raw: "" };
  return { configured: true, value: options.trimmed === false ? raw : raw.trim(), raw };
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
  // Not trimmed, because nothing downstream trims it either. glibc looks the
  // value up as given, so `TZ=" America/New_York "` matches no zone and every
  // service falls back to UTC — the backup scheduler included, which then runs
  // hours away from the hour the operator set, silently. Validating the trimmed
  // value said the zone was fine and left that unsaid. This stays a warning
  // rather than an error, as an outright unknown zone does: the fallback is
  // real but the app works, and TZ is only the default for accounts that have
  // not set their own.
  const tz = setting(env, "TZ", { trimmed: false });
  if (tz.configured && !isValidTimezone(tz.value)) {
    warnings.push(
      `TZ="${tz.raw}" is not a timezone this system knows. Falling back to UTC for anything ` +
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
      if (appUrl.endsWith("/")) {
        warnings.push(
          `APP_URL="${appUrl}" ends in a slash, which produces double slashes in ` +
            `notification links. Drop the trailing slash.`,
        );
      }
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
      "APP_URL is not set. Links in notifications will have no address to point at, and " +
        "session cookies will not be marked secure. Set it to your external URL.",
    );
  }

  // --- DATABASE_URL --------------------------------------------------------
  // Not trimmed: `using_external_database` in common.sh tests only for
  // non-empty, and `export_runtime_env` then hands the value to Prisma exactly
  // as given. Padding is therefore part of the URL, and a blank one turns the
  // bundled MariaDB off in favour of a database nothing can connect to — with
  // preflight, which trimmed before deciding whether to look, having called it
  // fine. `new URL` would not catch either, because it strips leading and
  // trailing spaces before parsing.
  const databaseUrl = setting(env, "DATABASE_URL", { trimmed: false });
  if (databaseUrl.configured) {
    if (databaseUrl.value !== databaseUrl.value.trim()) {
      errors.push(
        "DATABASE_URL has leading or trailing whitespace, and is passed to the database " +
          "driver exactly as set. Set it to the URL alone, or leave it empty to use the " +
          "bundled MariaDB.",
      );
    } else {
      let parsed;
      try {
        parsed = new URL(databaseUrl.value);
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
  }

  // --- BACKUPS -------------------------------------------------------------
  const backupTime = setting(env, "BACKUP_TIME");
  if (backupTime.configured && !/^([01]\d|2[0-3]):[0-5]\d$/.test(backupTime.value)) {
    errors.push(`BACKUP_TIME="${backupTime.raw}" is not a 24-hour HH:MM time.`);
  }
  const retentionDays = setting(env, "BACKUP_RETENTION_DAYS");
  if (retentionDays.configured && !/^[1-9]\d*$/.test(retentionDays.value)) {
    errors.push(`BACKUP_RETENTION_DAYS="${retentionDays.raw}" is not a positive integer.`);
  }
  const minimumFree = setting(env, "BACKUP_MIN_FREE_MB");
  if (minimumFree.configured && !/^\d+$/.test(minimumFree.value)) {
    errors.push(`BACKUP_MIN_FREE_MB="${minimumFree.raw}" is not a non-negative integer.`);
  }

  // --- PORT ----------------------------------------------------------------
  // Trimmed, and only when set to something: `parseInt` skips leading
  // whitespace and the standalone server falls back to 3000 on a NaN, so a
  // blank PORT is the one setting of these that genuinely is as good as unset.
  const port = setting(env, "PORT");
  if (port.configured && port.value !== "" && !/^\d+$/.test(port.value)) {
    errors.push(`PORT="${port.raw}" is not a number.`);
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
