import { describe, expect, it } from "vitest";
import {
  parseTrustedHops,
  resolveClientAddress,
  throttleAddress,
  UNTRUSTED_ADDRESS,
} from "@/lib/client-address";

describe("TRUSTED_PROXY_HOPS", () => {
  it("defaults to trusting nothing", () => {
    expect(parseTrustedHops(undefined)).toBe(0);
    expect(parseTrustedHops("")).toBe(0);
  });

  it("refuses anything that is not a whole number of hops", () => {
    // A typo must not silently become "trust the caller".
    expect(parseTrustedHops("one")).toBe(0);
    expect(parseTrustedHops("-1")).toBe(0);
    expect(parseTrustedHops("1.5")).toBe(0);
  });

  it("reads a real setting, and caps an absurd one", () => {
    expect(parseTrustedHops("1")).toBe(1);
    expect(parseTrustedHops(" 2 ")).toBe(2);
    expect(parseTrustedHops("500")).toBe(8);
  });
});

describe("resolving the client address", () => {
  it("ignores forwarded headers entirely when nothing is trusted", () => {
    // The bug this closes: the leftmost entry is whatever the caller wrote, so
    // reading it let one header buy a fresh throttle allowance per request.
    expect(
      resolveClientAddress({ forwardedFor: "1.2.3.4, 10.0.0.1", realIp: "9.9.9.9" }, 0),
    ).toBeNull();
  });

  it("takes the entry the trusted proxy appended, not the one the caller sent", () => {
    expect(
      resolveClientAddress({ forwardedFor: "203.0.113.9, 198.51.100.7" }, 1),
    ).toBe("198.51.100.7");
  });

  it("counts hops in from the right for a longer chain", () => {
    expect(
      resolveClientAddress({ forwardedFor: "evil, real-client, inner-proxy" }, 2),
    ).toBe("real-client");
  });

  it("cannot be pushed off the end by padding the header", () => {
    // Spoofed entries are prepended, so they only ever lengthen the chain —
    // which moves the trusted entry no closer to the caller's control.
    const padded = { forwardedFor: `${"spoof, ".repeat(50)}real-client` };
    expect(resolveClientAddress(padded, 1)).toBe("real-client");
  });

  it("treats a chain shorter than configured as untrusted, not as a fallback", () => {
    // Falling back to the leftmost entry here is how the original bug would
    // creep back in: a misconfiguration must fail closed.
    expect(resolveClientAddress({ forwardedFor: "1.2.3.4" }, 2)).toBeNull();
  });

  it("accepts X-Real-IP only when a proxy is trusted and set no chain", () => {
    expect(resolveClientAddress({ realIp: "198.51.100.7" }, 1)).toBe("198.51.100.7");
    expect(resolveClientAddress({ realIp: "198.51.100.7" }, 0)).toBeNull();
  });

  it("prefers the forwarded chain over X-Real-IP when both are present", () => {
    expect(
      resolveClientAddress({ forwardedFor: "a, b", realIp: "9.9.9.9" }, 1),
    ).toBe("b");
  });

  it("ignores empty entries a proxy may leave behind", () => {
    expect(resolveClientAddress({ forwardedFor: "a, , b" }, 1)).toBe("b");
  });

  it("truncates an address longer than anything that could be stored", () => {
    const resolved = resolveClientAddress({ forwardedFor: "x".repeat(500) }, 1);
    expect(resolved).toHaveLength(64);
  });
});

describe("the throttle key", () => {
  it("collapses onto one counter per address when nothing is trustworthy", () => {
    // Deliberate: with no verifiable client, throttling the account is the only
    // protection left, and it is better than none. Documented in privacy.md.
    expect(throttleAddress({ forwardedFor: "1.2.3.4" }, 0)).toBe(UNTRUSTED_ADDRESS);
    expect(throttleAddress({ forwardedFor: "5.6.7.8" }, 0)).toBe(UNTRUSTED_ADDRESS);
  });

  it("separates clients once a proxy is trusted", () => {
    expect(throttleAddress({ forwardedFor: "a, 198.51.100.7" }, 1)).toBe("198.51.100.7");
    expect(throttleAddress({ forwardedFor: "a, 198.51.100.8" }, 1)).toBe("198.51.100.8");
  });
});
