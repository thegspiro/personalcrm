import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "@/lib/app-url";

describe("the address a subscription URL is built on", () => {
  it("prefers APP_URL, which is the address an outside service must resolve", () => {
    expect(
      resolveAppUrl("https://crm.example.com", { host: "127.0.0.1:3000" }),
    ).toBe("https://crm.example.com");
  });

  it("trims a trailing slash so the path is not joined onto a double one", () => {
    expect(resolveAppUrl("https://crm.example.com/", {})).toBe("https://crm.example.com");
  });

  it("ignores an APP_URL that is only whitespace", () => {
    expect(resolveAppUrl("   ", { host: "crm.example.com" })).toBe("https://crm.example.com");
  });

  it("falls back to the forwarded host ahead of the direct one", () => {
    expect(
      resolveAppUrl(undefined, {
        host: "internal:3000",
        forwardedHost: "crm.example.com",
        forwardedProto: "https",
      }),
    ).toBe("https://crm.example.com");
  });

  it("takes the first entry when a proxy chain appended more", () => {
    expect(
      resolveAppUrl(undefined, {
        forwardedHost: "crm.example.com, inner.local",
        forwardedProto: "https, http",
      }),
    ).toBe("https://crm.example.com");
  });

  it("assumes http only for a plainly local host", () => {
    expect(resolveAppUrl(undefined, { host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(resolveAppUrl(undefined, { host: "127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  });

  it("assumes https for anything reached by name, which is usually behind TLS", () => {
    expect(resolveAppUrl(undefined, { host: "crm.example.com" })).toBe("https://crm.example.com");
  });

  it("returns an empty string when there is nothing to go on", () => {
    expect(resolveAppUrl(undefined, {})).toBe("");
  });
});
