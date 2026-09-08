import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  counterFor,
  formatSecretForDisplay,
  generateSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "@/server/crypto/totp";

/**
 * RFC 6238's own test vectors, which is the reason this is written out rather
 * than taken from a package: the algorithm is publishable and checkable.
 *
 * The published table is for a 20-byte ASCII secret "12345678901234567890" and
 * eight digits; these assert the six-digit truncation of the same values, which
 * is what an authenticator app produces.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 6238 vectors", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  for (const [seconds, expected] of vectors) {
    it(`produces ${expected} at ${seconds}`, () => {
      expect(totpCode(RFC_SECRET, new Date(seconds * 1000))).toBe(expected);
    });
  }
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("matches the RFC 4648 examples", () => {
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString("ascii")).toBe("foobar");
  });

  it("forgives how a person types a key off a screen", () => {
    // Spaces, hyphens, lower case and the padding some apps show.
    expect(base32Decode("mzxw 6ytb-oi=").toString("ascii")).toBe("foobar");
  });

  it("refuses characters the alphabet does not contain", () => {
    // 0, 1 and 8 are excluded precisely because they are misread.
    expect(() => base32Decode("MZXW0YTB")).toThrow();
  });

  it("generates a 20-byte secret, which is what RFC 4226 recommends", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });
});

describe("verifying a code", () => {
  const at = new Date(1_700_000_000_000);

  it("accepts the current code and reports its step", () => {
    const result = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at), { at });
    expect(result.ok).toBe(true);
    expect(result.step).toBe(counterFor(at));
  });

  it("tolerates a phone whose clock is a step out, either way", () => {
    const early = new Date(at.getTime() - 30_000);
    const late = new Date(at.getTime() + 30_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, early), { at }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, late), { at }).ok).toBe(true);
  });

  it("refuses a code two steps out, which is guessing room rather than drift", () => {
    const stale = new Date(at.getTime() - 90_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, stale), { at }).ok).toBe(false);
  });

  it("refuses a step already spent, so a code cannot be replayed in its window", () => {
    const code = totpCode(RFC_SECRET, at);
    const first = verifyTotp(RFC_SECRET, code, { at });
    expect(first.ok).toBe(true);

    const replay = verifyTotp(RFC_SECRET, code, { at, lastUsedStep: first.step });
    expect(replay.ok).toBe(false);
  });

  it("still accepts the next code after one has been spent", () => {
    const spent = counterFor(at);
    const next = new Date(at.getTime() + 30_000);
    const result = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, next), {
      at: next,
      lastUsedStep: spent,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses anything that is not six digits without doing any work", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5a"]) {
      expect(verifyTotp(RFC_SECRET, bad, { at }).ok).toBe(false);
    }
  });

  it("accepts a code typed with a space in the middle", () => {
    const code = totpCode(RFC_SECRET, at);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced, { at }).ok).toBe(true);
  });

  it("fails closed on a stored secret that is not base32", () => {
    expect(verifyTotp("not!base32", "123456", { at }).ok).toBe(false);
  });

  it("refuses a code for a different secret", () => {
    expect(verifyTotp(generateSecret(), totpCode(RFC_SECRET, at), { at }).ok).toBe(false);
  });
});

describe("what the person is shown", () => {
  it("builds an otpauth URI an authenticator can import", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "sam@example.com");
    expect(uri.startsWith("otpauth://totp/Personal%20CRM:sam%40example.com?")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Personal+CRM");
    expect(uri).toContain("period=30");
    expect(uri).toContain("digits=6");
  });

  it("groups the key so it can be typed off a screen", () => {
    expect(formatSecretForDisplay("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
