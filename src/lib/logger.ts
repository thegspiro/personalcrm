/**
 * The parts of logging that are pure: levels, redaction, and record shape.
 *
 * Kept out of `src/server/` so the rules can be asserted directly rather than
 * through a captured stream, and so nothing that formats a line has to reach
 * for a request context it does not have. The writing half is
 * `src/server/log.ts`; this half never touches a stream.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Levels that produce output, in increasing severity. */
export type EmittedLevel = Exclude<LogLevel, "silent">;

export const LOG_FORMATS = ["text", "json"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

export type LogFields = Record<string, unknown>;

export interface LogRecord {
  time: string;
  level: EmittedLevel;
  scope: string;
  message: string;
  fields: LogFields;
}

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export function parseLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  const value = raw?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(value ?? "") ? (value as LogLevel) : fallback;
}

export function parseFormat(raw: string | undefined, fallback: LogFormat = "text"): LogFormat {
  const value = raw?.trim().toLowerCase();
  return (LOG_FORMATS as readonly string[]).includes(value ?? "") ? (value as LogFormat) : fallback;
}

/** Whether a line at `level` survives a logger configured at `configured`. */
export function levelEnabled(configured: LogLevel, level: EmittedLevel): boolean {
  return SEVERITY[level] >= SEVERITY[configured];
}

/**
 * A connection string with its password replaced.
 *
 * Driver errors quote the DSN they failed on, so `DATABASE_URL` reaches a log
 * line without anyone deciding to log it — and on this project that line was
 * being returned to an unauthenticated caller by `/api/health`. Redacting at
 * the point of formatting means every future call site inherits the guard
 * instead of each one having to remember.
 */
const CREDENTIALED_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@]*@/gi;

/** `password = "…"`, `token: …`, `--password=…` — the shapes that show up in prose. */
const INLINE_SECRET =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(CREDENTIALED_URL, "$1:***@")
    .replace(INLINE_SECRET, (_match, key: string, separator: string) => `${key}${separator}***`);
}

const SECRET_WORDS = new Set([
  "auth",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "key",
  "pass",
  "passwd",
  "password",
  "pin",
  "pwd",
  "secret",
  "token",
]);

/**
 * A field name split into its words, `apiKey` and `api_key` alike.
 *
 * Substring matching was the first attempt and it masked `passes` and
 * `monkey`, which is the failure that teaches call sites to distrust the log.
 * Whole words are predictable: a field is masked when it is *named* after a
 * secret, so `accounts` and `attempts` survive while `apiKey` does not — and
 * the rule is simple enough to hold in your head when naming a field. Note it
 * costs the plain names `key` and `auth`; prefer `setting` and `scheme`.
 */
function nameWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function isSecretFieldName(key: string): boolean {
  return nameWords(key).some((word) => SECRET_WORDS.has(word));
}

/**
 * Field values masked by the name they were given.
 *
 * Matching on the key rather than the value is deliberate: a token is not
 * recognisable by looking at it, and the one time it matters is the time
 * somebody logged the whole object without reading it first.
 */
export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (isSecretFieldName(key)) {
      out[key] = "***";
    } else if (typeof value === "string") {
      out[key] = redactSecrets(value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactFields(value as LogFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface DescribedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * An unknown throw reduced to something loggable, with secrets already out of
 * it. Non-Errors are stringified rather than dropped, because the throw that
 * is not an Error is exactly the one nobody anticipated.
 */
export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message),
      ...(error.stack ? { stack: redactSecrets(error.stack) } : {}),
    };
  }
  return { name: "NonError", message: redactSecrets(String(error)) };
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

/** The field name `describeError` output is conventionally logged under. */
export const ERROR_FIELD = "err";

function isDescribedError(value: unknown): value is DescribedError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DescribedError).name === "string" &&
    typeof (value as DescribedError).message === "string"
  );
}

/**
 * One record, in the configured shape. May span several lines in text mode.
 *
 * The text form keeps the `[scope]` prefix the container log has always
 * carried, so an operator's existing `grep '\[startup\]'` still finds the same
 * lines after this change; the level and timestamp are added ahead of it rather
 * than in place of it.
 *
 * A stack is the one field worth breaking the one-record-one-line rule for.
 * Escaped into a `key=value` pair it is unreadable at exactly the moment
 * somebody needs to read it, so text mode prints it indented underneath and
 * JSON mode — which is being parsed, not read — keeps it inline.
 */
export function formatRecord(record: LogRecord, format: LogFormat): string {
  const fields = redactFields(record.fields);
  if (format === "json") {
    return JSON.stringify({
      time: record.time,
      level: record.level,
      scope: record.scope,
      message: redactSecrets(record.message),
      ...fields,
    });
  }

  let trailer = "";
  const inline: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === ERROR_FIELD && isDescribedError(value)) {
      inline.push(` ${key}=${renderValue(`${value.name}: ${value.message}`)}`);
      if (value.stack) {
        trailer = `\n${value.stack.replace(/^/gm, "    ")}`;
      }
      continue;
    }
    inline.push(` ${key}=${renderValue(value)}`);
  }

  const head = `${record.time} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${redactSecrets(record.message)}`;
  return `${head}${inline.join("")}${trailer}`;
}
