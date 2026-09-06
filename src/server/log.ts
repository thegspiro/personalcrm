import "server-only";
import {
  describeError,
  ERROR_FIELD,
  formatRecord,
  levelEnabled,
  parseFormat,
  parseLevel,
  type EmittedLevel,
  type LogFields,
  type LogFormat,
  type LogLevel,
} from "@/lib/logger";

/**
 * The server's log sink.
 *
 * Everything here used to be a bare `console.log` with a hand-written
 * `[scope]` prefix, which meant three things an operator needed were missing:
 * a level to filter on, a machine-readable shape for anyone shipping the
 * container's stdout somewhere, and any guarantee that a credential quoted
 * inside a driver error would not be written out verbatim. The first two are
 * configuration; the third is `src/lib/logger.ts` doing the redaction on the
 * way out, so no call site has to be trusted to think of it.
 *
 * Reads its configuration once per process. `LOG_LEVEL` and `LOG_FORMAT` are
 * both optional and both default to what the container printed before, so an
 * existing install that sets neither sees the same lines with a level and a
 * timestamp in front of them.
 */
function configuredLevel(): LogLevel {
  return parseLevel(process.env.LOG_LEVEL, process.env.NODE_ENV === "production" ? "info" : "debug");
}

function configuredFormat(): LogFormat {
  return parseFormat(process.env.LOG_FORMAT);
}

let level: LogLevel | null = null;
let format: LogFormat | null = null;

/** Re-read `LOG_LEVEL` and `LOG_FORMAT`. Exists so a test can change them. */
export function resetLoggerConfig(): void {
  level = null;
  format = null;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `error` is the thrown value, of any shape; it is described and redacted. */
  error(message: string, error?: unknown, fields?: LogFields): void;
  /** A logger that prefixes a narrower scope and carries the given fields. */
  child(scope: string, fields?: LogFields): Logger;
}

function write(
  scope: string,
  bound: LogFields,
  at: EmittedLevel,
  message: string,
  fields: LogFields,
): void {
  level ??= configuredLevel();
  if (!levelEnabled(level, at)) return;
  format ??= configuredFormat();

  const line = formatRecord(
    {
      time: new Date().toISOString(),
      level: at,
      scope,
      message,
      fields: { ...bound, ...fields },
    },
    format,
  );

  // warn and error to stderr so a supervisor that separates the two streams —
  // s6 does — keeps failures visible when stdout is being collected elsewhere.
  if (at === "warn" || at === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(scope: string, bound: LogFields = {}): Logger {
  return {
    debug: (message, fields = {}) => write(scope, bound, "debug", message, fields),
    info: (message, fields = {}) => write(scope, bound, "info", message, fields),
    warn: (message, fields = {}) => write(scope, bound, "warn", message, fields),
    error: (message, error, fields = {}) =>
      write(scope, bound, "error", message, {
        ...fields,
        ...(error === undefined ? {} : { [ERROR_FIELD]: describeError(error) }),
      }),
    child: (childScope, childFields = {}) =>
      createLogger(`${scope}:${childScope}`, { ...bound, ...childFields }),
  };
}

/** The default logger, for code that has no more specific scope. */
export const log = createLogger("app");
