import { afterEach, describe, expect, it } from "vitest";
import config from "../../next.config";

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  process.env.APP_URL = originalAppUrl;
});

describe("security response headers", () => {
  it("denies framing and prevents sensitive route caching", async () => {
    const entries = await config.headers!();
    const global = entries.find((entry) => entry.source === "/:path*");
    const dating = entries.find((entry) => entry.source === "/dating/:path*");

    expect(global?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        expect.objectContaining({ key: "Content-Security-Policy" }),
      ]),
    );
    expect(dating?.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  });

  it("only advertises HSTS for an HTTPS deployment", async () => {
    process.env.APP_URL = "http://crm.example.test";
    let entries = await config.headers!();
    expect(entries[0]?.headers.some((header) => header.key === "Strict-Transport-Security")).toBe(false);

    process.env.APP_URL = "https://crm.example.test";
    entries = await config.headers!();
    expect(entries[0]?.headers).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  });
});
