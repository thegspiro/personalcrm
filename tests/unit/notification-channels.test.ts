import { describe, expect, it } from "vitest";
import {
  CHANNEL_FIELDS,
  CHANNEL_KINDS,
  TEST_NOTIFICATION_BODY,
  TEST_NOTIFICATION_SUBJECT,
  encryptedKeyFor,
  isChannelKind,
  secretFieldsFor,
  isPrivateHostname,
  targetsPrivateHost,
  validateChannelConfig,
} from "@/lib/notification-channels";

describe("validateChannelConfig — email", () => {
  const base = { host: "smtp.example.com", from: "crm@example.com", to: "me@example.com" };

  it("accepts a complete configuration", () => {
    const result = validateChannelConfig("EMAIL", base);
    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({ host: "smtp.example.com", from: "crm@example.com" });
  });

  it("stores the port as a number", () => {
    // The sender does `typeof config.port === "number" ? config.port : 587`,
    // so a string here would silently send everything to 587 instead.
    const result = validateChannelConfig("EMAIL", { ...base, port: "2525" });
    expect(result.config.port).toBe(2525);
    expect(typeof result.config.port).toBe("number");
  });

  it("defaults the port rather than leaving it undefined", () => {
    expect(validateChannelConfig("EMAIL", base).config.port).toBe(587);
  });

  it("rejects a port that is not a whole number in range", () => {
    for (const port of ["0", "70000", "-1", "5.5", "smtp"]) {
      expect(validateChannelConfig("EMAIL", { ...base, port }).errors.port).toBeTruthy();
    }
  });

  it("requires host, from and to, because the sender throws without them", () => {
    const result = validateChannelConfig("EMAIL", {});
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["from", "host", "to"]);
  });

  it("rejects an address that is not one", () => {
    expect(validateChannelConfig("EMAIL", { ...base, to: "nope" }).errors.to).toBeTruthy();
  });

  it("records the TLS choice as a boolean either way", () => {
    expect(validateChannelConfig("EMAIL", base).config.secure).toBe(false);
    expect(validateChannelConfig("EMAIL", { ...base, secure: "true" }).config.secure).toBe(true);
    expect(validateChannelConfig("EMAIL", { ...base, secure: "on" }).config.secure).toBe(true);
  });

  it("never puts a secret in the validated config", () => {
    const result = validateChannelConfig("EMAIL", { ...base, pass: "hunter2" });
    expect(JSON.stringify(result.config)).not.toContain("hunter2");
  });
});

describe("validateChannelConfig — url channels", () => {
  for (const kind of ["NTFY", "GOTIFY", "WEBHOOK"] as const) {
    it(`accepts an http(s) URL for ${kind}`, () => {
      const result = validateChannelConfig(kind, { url: "https://ntfy.example.com/topic" });
      expect(result.ok).toBe(true);
      expect(result.config.url).toBe("https://ntfy.example.com/topic");
    });

    it(`refuses anything that is not http(s) for ${kind}`, () => {
      for (const url of ["", "file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
        expect(validateChannelConfig(kind, { url }).ok).toBe(false);
      }
    });
  }

  it("treats a Discord webhook URL as the credential it is", () => {
    // The token is in the path, so it goes through the encrypted path and must
    // never appear in the readable config that reaches the browser.
    expect(secretFieldsFor("DISCORD").map((field) => field.name)).toEqual(["url"]);

    const result = validateChannelConfig("DISCORD", {
      url: "https://discord.com/api/webhooks/123/abcdef",
    });
    expect(result.ok).toBe(true);
    expect(result.config.url).toBeUndefined();
    expect(JSON.stringify(result.config)).not.toContain("abcdef");
  });

  it("still refuses a Discord URL that is not http(s)", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      expect(validateChannelConfig("DISCORD", { url }).ok).toBe(false);
    }
  });

  it("lets a blank secret URL through, because blank means keep the stored one", () => {
    // Only the action can see what is already saved, so presence is its check.
    expect(validateChannelConfig("DISCORD", {}).ok).toBe(true);
  });
});

describe("the field table", () => {
  it("covers every kind", () => {
    for (const kind of CHANNEL_KINDS) {
      expect(CHANNEL_FIELDS[kind].length).toBeGreaterThan(0);
    }
  });

  it("names the encrypted key beside its field, never in place of it", () => {
    expect(encryptedKeyFor("pass")).toBe("passEnc");
    expect(encryptedKeyFor("token")).toBe("tokenEnc");
  });

  it("marks exactly the credentials as secret", () => {
    expect(secretFieldsFor("EMAIL").map((f) => f.name)).toEqual(["pass"]);
    expect(secretFieldsFor("WEBHOOK").map((f) => f.name)).toEqual(["token"]);
    expect(secretFieldsFor("DISCORD").map((f) => f.name)).toEqual(["url"]);
  });

  it("refuses a kind that is not one", () => {
    expect(isChannelKind("EMAIL")).toBe(true);
    expect(isChannelKind("SMS")).toBe(false);
    expect(isChannelKind(null)).toBe(false);
  });
});

describe("the test notification", () => {
  it("is fixed copy with nothing interpolated into it", () => {
    // Settings stays reachable while the privacy lock is closed, so this is the
    // one button there that could otherwise put a private person's name on the
    // wire. There has to be nothing in it to leak.
    for (const text of [TEST_NOTIFICATION_SUBJECT, TEST_NOTIFICATION_BODY]) {
      expect(text).not.toMatch(/[${}]/);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe("targetsPrivateHost", () => {
  it("recognises the literal addresses a probe would use", () => {
    for (const url of [
      "http://127.0.0.1:8080/hook",
      "http://localhost:3000/hook",
      "https://10.0.0.5/message",
      "http://192.168.1.1/",
      "http://172.16.0.9/",
      "http://172.31.255.254/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://[::1]:8080/",
      "http://[fd00::1]/",
    ]) {
      expect(targetsPrivateHost(url), url).toBe(true);
    }
  });

  it("leaves public addresses and ordinary hostnames alone", () => {
    for (const url of [
      "https://ntfy.sh/my-topic",
      "https://discord.com/api/webhooks/1/x",
      "https://gotify.example.com/message",
      "http://172.32.0.1/",
      "http://8.8.8.8/",
      "http://192.169.1.1/",
      "not a url",
    ]) {
      expect(targetsPrivateHost(url), url).toBe(false);
    }
  });

  it("answers the same question of a bare hostname, which is what SMTP gives", () => {
    // An email channel has a host and a port, not a URL.
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("10.0.0.25")).toBe(true);
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("smtp.example.com")).toBe(false);
    expect(isPrivateHostname("  ")).toBe(false);
  });

  it("does not treat a hostname that merely looks numeric as private", () => {
    // Four dotted parts, but not an address.
    expect(targetsPrivateHost("http://10.0.0.999/")).toBe(false);
  });
});

describe("Gotify", () => {
  it("asks for an application token rather than calling it optional", () => {
    const token = CHANNEL_FIELDS.GOTIFY.find((field) => field.name === "token");
    // Gotify rejects a message posted without one, so a channel saved blank is
    // a channel that never delivers.
    expect(token?.secret).toBe(true);
    expect(token?.hint).toMatch(/required/i);
  });
});
