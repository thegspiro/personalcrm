import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeError,
  formatRecord,
  levelEnabled,
  parseFormat,
  parseLevel,
  isSecretFieldName,
  redactFields,
  redactSecrets,
  type LogRecord,
} from "@/lib/logger";
import { createLogger, resetLoggerConfig } from "@/server/log";

const RECORD: LogRecord = {
  time: "2026-09-06T12:00:00.000Z",
  level: "info",
  scope: "startup",
  message: "taxonomies verified",
  fields: { accounts: 3 },
};

describe("log level configuration", () => {
  it("accepts every documented level, case-insensitively", () => {
    expect(parseLevel("DEBUG")).toBe("debug");
    expect(parseLevel(" warn ")).toBe("warn");
    expect(parseLevel("silent")).toBe("silent");
  });

  it("falls back rather than throwing on a value nobody defined", () => {
    // A typo in LOG_LEVEL must not stop the container: the wrong verbosity is
    // recoverable, a boot loop over an environment variable is not.
    expect(parseLevel("verbose")).toBe("info");
    expect(parseLevel(undefined, "warn")).toBe("warn");
    expect(parseFormat("yaml")).toBe("text");
    expect(parseFormat("json")).toBe("json");
  });

  it("emits at or above the configured level and nothing below it", () => {
    expect(levelEnabled("warn", "error")).toBe(true);
    expect(levelEnabled("warn", "warn")).toBe(true);
    expect(levelEnabled("warn", "info")).toBe(false);
    expect(levelEnabled("silent", "error")).toBe(false);
  });
});

describe("redaction", () => {
  it("keeps a connection string's password out of a line", () => {
    // The case this exists for: a driver error quotes DATABASE_URL, so the
    // credential reaches a log without anyone deciding to log it.
    const message =
      "Can't reach database server at mysql://crm:hunter2@db.internal:3306/personalcrm";
    expect(redactSecrets(message)).toContain("mysql://crm:***@db.internal:3306/personalcrm");
    expect(redactSecrets(message)).not.toContain("hunter2");
  });

  it("leaves a URL with no credential in it alone", () => {
    expect(redactSecrets("fetching https://api.example.com/v1/geo")).toBe(
      "fetching https://api.example.com/v1/geo",
    );
  });

  it("masks inline secret assignments whatever the punctuation", () => {
    expect(redactSecrets('password="hunter2"')).toBe("password=***");
    expect(redactSecrets("api_key: abc123")).toBe("api_key: ***");
    expect(redactSecrets("--password=hunter2")).toBe("--password=***");
  });

  it("masks by whole words, so passes and monkey survive", () => {
    // Substring matching was the first rule and it masked both of these. A log
    // that hides ordinary counts is one nobody trusts to show the real ones.
    expect(redactFields({ passes: 3, monkey: "x", attempts: 2 })).toEqual({
      passes: 3,
      monkey: "x",
      attempts: 2,
    });
    expect(isSecretFieldName("apiKey")).toBe(true);
    expect(isSecretFieldName("api_key")).toBe(true);
    expect(isSecretFieldName("bypass")).toBe(false);
  });

  it("masks fields by the name they were given, at any depth", () => {
    expect(
      redactFields({
        email: "a@example.com",
        authSecret: "s3cret",
        nested: { apiKey: "k", channel: "email" },
      }),
    ).toEqual({
      email: "a@example.com",
      authSecret: "***",
      nested: { apiKey: "***", channel: "email" },
    });
  });

  it("drops undefined fields instead of printing them", () => {
    expect(redactFields({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
});

describe("describeError", () => {
  it("keeps a non-Error throw rather than dropping it", () => {
    expect(describeError("boom")).toEqual({ name: "NonError", message: "boom" });
  });

  it("redacts the message and the stack alike", () => {
    const error = new Error("connect mysql://crm:hunter2@db:3306/x failed");
    const described = describeError(error);
    expect(described.message).not.toContain("hunter2");
    expect(described.stack ?? "").not.toContain("hunter2");
  });
});

describe("formatRecord", () => {
  it("keeps the [scope] prefix an operator's existing grep depends on", () => {
    expect(formatRecord(RECORD, "text")).toContain("[startup]");
  });

  it("renders text as one line with key=value fields", () => {
    expect(formatRecord(RECORD, "text")).toBe(
      "2026-09-06T12:00:00.000Z INFO  [startup] taxonomies verified accounts=3",
    );
  });

  it("renders json as a single parseable object", () => {
    expect(JSON.parse(formatRecord(RECORD, "json"))).toEqual({
      time: "2026-09-06T12:00:00.000Z",
      level: "info",
      scope: "startup",
      message: "taxonomies verified",
      accounts: 3,
    });
  });

  it("prints a stack under the line in text mode, not escaped into it", () => {
    const line = formatRecord(
      { ...RECORD, level: "error", fields: { err: { name: "Error", message: "no", stack: "Error: no\n  at x" } } },
      "text",
    );
    const [head, ...rest] = line.split("\n");
    expect(head).toContain('err="Error: no"');
    expect(rest.join("\n")).toBe("    Error: no\n      at x");
  });

  it("keeps a stack inline in json mode, which is parsed rather than read", () => {
    const parsed = JSON.parse(
      formatRecord(
        { ...RECORD, fields: { err: { name: "Error", message: "no", stack: "Error: no" } } },
        "json",
      ),
    );
    expect(parsed.err).toEqual({ name: "Error", message: "no", stack: "Error: no" });
  });
});

describe("the server logger", () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
    resetLoggerConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
    resetLoggerConfig();
  });

  it("sends warn and error to stderr and the rest to stdout", () => {
    process.env.LOG_LEVEL = "debug";
    const log = createLogger("test");
    log.info("up");
    log.error("down", new Error("nope"));
    expect(out.join("")).toContain("[test] up");
    expect(err.join("")).toContain("[test] down");
    expect(out.join("")).not.toContain("down");
  });

  it("writes nothing below the configured level", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger("test");
    log.info("quiet");
    log.warn("loud");
    expect(out).toHaveLength(0);
    expect(err.join("")).toContain("loud");
  });

  it("says nothing at all when silenced", () => {
    process.env.LOG_LEVEL = "silent";
    const log = createLogger("test");
    log.error("still nothing", new Error("x"));
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(0);
  });

  it("nests a child scope and carries its bound fields", () => {
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_FORMAT = "json";
    createLogger("reminders", { attempt: 1 }).child("email", { channel: "smtp" }).info("sent");
    const parsed = JSON.parse(out.join("").trim());
    expect(parsed.scope).toBe("reminders:email");
    expect(parsed.channel).toBe("smtp");
    expect(parsed.attempt).toBe(1);
  });

  it("redacts a credential quoted by the error it is handed", () => {
    process.env.LOG_LEVEL = "error";
    createLogger("health").error(
      "database unreachable",
      new Error("auth failed for mysql://crm:hunter2@db:3306/personalcrm"),
    );
    expect(err.join("")).not.toContain("hunter2");
    expect(err.join("")).toContain("mysql://crm:***@db:3306/personalcrm");
  });
});
