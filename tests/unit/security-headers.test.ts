import { describe, expect, it } from "vitest";
import config from "../../next.config";

describe("security response headers", () => {
  it("denies framing and prevents sensitive route caching", async () => {
    const entries = await config.headers!();
    const global = entries.find((entry) => entry.source === "/:path*");

    expect(global?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        expect.objectContaining({ key: "Content-Security-Policy" }),
        expect.objectContaining({ key: "Permissions-Policy" }),
      ]),
    );

    // Anything the closed lock is meant to hide must not survive in a browser
    // or proxy cache after it closes.
    for (const source of ["/dating/:path*", "/unlock/:path*", "/settings/:path*"]) {
      expect(entries.find((entry) => entry.source === source)?.headers).toContainEqual({
        key: "Cache-Control",
        value: "private, no-store",
      });
    }
  });

  it("never sends HSTS, which is the proxy's to decide", async () => {
    // Next evaluates `headers()` during the build and writes the result into
    // routes-manifest.json, so it cannot see runtime configuration such as
    // APP_URL. A conditional here would read as HTTPS-aware while in fact
    // being decided — always the same way — by whoever ran `next build`.
    // Verified: building with APP_URL unset emits no such header, and setting
    // it only changes the output when set at build time, which the container
    // never does.
    const headers = (await config.headers!()).flatMap((entry) => entry.headers);
    expect(headers.map((header) => header.key)).not.toContain("Strict-Transport-Security");
  });
});
