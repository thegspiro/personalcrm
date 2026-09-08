import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, parseReportOnly } from "@/lib/csp";

const NONCE = "abc123";

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/);
      return [name!, rest.join(" ")];
    }),
  );
}

describe("the content security policy", () => {
  it("carries the request's nonce on script-src", () => {
    expect(directives(buildCsp(NONCE)).get("script-src")).toContain(`'nonce-${NONCE}'`);
  });

  it("uses strict-dynamic, so our own origin is not a blanket script source", () => {
    // The protection worth having: without it, anything that can write a file
    // under the origin — or traverse onto one — becomes a script source.
    expect(directives(buildCsp(NONCE)).get("script-src")).toContain("'strict-dynamic'");
  });

  it("never allows inline or eval'd script in a production build", () => {
    const script = directives(buildCsp(NONCE)).get("script-src") ?? "";
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development, where fast refresh compiles in the browser", () => {
    expect(directives(buildCsp(NONCE, { development: true })).get("script-src")).toContain(
      "'unsafe-eval'",
    );
  });

  it("keeps the protections the previous static policy already had", () => {
    const parsed = directives(buildCsp(NONCE));
    expect(parsed.get("frame-ancestors")).toBe("'none'");
    expect(parsed.get("base-uri")).toBe("'self'");
    expect(parsed.get("form-action")).toBe("'self'");
  });

  it("locks down the directives an injected payload would otherwise reach for", () => {
    const parsed = directives(buildCsp(NONCE));
    expect(parsed.get("default-src")).toBe("'self'");
    expect(parsed.get("object-src")).toBe("'none'");
    expect(parsed.get("frame-src")).toBe("'none'");
    // Nothing in the browser talks to a third party, so exfiltration by fetch
    // has nowhere to go.
    expect(parsed.get("connect-src")).toBe("'self'");
  });

  it("allows the image sources the app actually uses, and no remote one", () => {
    // `data:` for icons drawn at build time, `blob:` for an avatar preview.
    expect(directives(buildCsp(NONCE)).get("img-src")).toBe("'self' data: blob:");
  });

  it("permits inline style, which Next and Tailwind both require", () => {
    // A known and documented trade: style injection is defacement, not code
    // execution, and there is no nonce path that reaches all of it.
    expect(directives(buildCsp(NONCE)).get("style-src")).toContain("'unsafe-inline'");
  });
});

describe("the report-only escape hatch", () => {
  it("enforces by default, because a report-only policy mitigates nothing", () => {
    expect(cspHeaderName(false)).toBe("Content-Security-Policy");
    expect(parseReportOnly(undefined)).toBe(false);
    expect(parseReportOnly("")).toBe(false);
    expect(parseReportOnly("no")).toBe(false);
  });

  it("downgrades on the values an operator would actually type", () => {
    for (const value of ["1", "true", "TRUE", " yes "]) {
      expect(parseReportOnly(value)).toBe(true);
    }
    expect(cspHeaderName(true)).toBe("Content-Security-Policy-Report-Only");
  });
});
