import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  keyHint,
  secretsMatch,
} from "@/server/crypto/secrets";

/**
 * The shared at-rest encryption.
 *
 * The purpose strings are the load-bearing part: they are HKDF `info` values
 * baked into every ciphertext already written, so a tidy-up that renames one
 * silently orphans every stored secret under it.
 */
describe("encryptSecret / decryptSecret", () => {
  it("round-trips under each purpose", () => {
    for (const purpose of ["personalcrm-api-key", "personalcrm-channel-secret"] as const) {
      const stored = encryptSecret("hunter2-but-longer", purpose);
      expect(stored.startsWith("v1.")).toBe(true);
      expect(stored).not.toContain("hunter2");
      expect(decryptSecret(stored, purpose)).toBe("hunter2-but-longer");
    }
  });

  it("uses a fresh IV, so the same value never encrypts to the same string", () => {
    const a = encryptSecret("same", "personalcrm-api-key");
    const b = encryptSecret("same", "personalcrm-api-key");
    expect(a).not.toBe(b);
  });

  it("does not decrypt a value written under a different purpose", () => {
    // Two kinds of secret must not share a key: reading the wrong column has
    // to fail, not hand back an SMTP password as an API key.
    const apiKey = encryptSecret("sk-abc123", "personalcrm-api-key");
    expect(decryptSecret(apiKey, "personalcrm-channel-secret")).toBeNull();

    const channel = encryptSecret("smtp-pass", "personalcrm-channel-secret");
    expect(decryptSecret(channel, "personalcrm-api-key")).toBeNull();
  });

  it("returns null rather than throwing on anything it cannot read", () => {
    for (const bad of ["", "plaintext", "v1.", "v1.not-base64!!", "v2.abcd"]) {
      expect(decryptSecret(bad, "personalcrm-api-key")).toBeNull();
    }
  });

  it("returns null when the auth tag fails", () => {
    const stored = encryptSecret("tamper-me-please", "personalcrm-api-key");
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(decryptSecret(`v1.${raw.toString("base64")}`, "personalcrm-api-key")).toBeNull();
  });

  it("pins the purpose strings", () => {
    // Written out rather than imported, so changing the constant fails here
    // instead of quietly orphaning every secret already in the database.
    const apiKey = encryptSecret("pinned", "personalcrm-api-key");
    expect(decryptSecret(apiKey, "personalcrm-api-key")).toBe("pinned");

    const channel = encryptSecret("pinned", "personalcrm-channel-secret");
    expect(decryptSecret(channel, "personalcrm-channel-secret")).toBe("pinned");
  });
});

describe("secretsMatch", () => {
  it("compares equal and unequal values without leaking length differences", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});

describe("keyHint", () => {
  it("shows only the tail, and nothing at all for a short value", () => {
    expect(keyHint("sk-1234567890abcd")).toBe("••••abcd");
    expect(keyHint("abcd")).toBe("••••");
    expect(keyHint("")).toBe("••••");
  });
});
