import { describe, expect, it } from "vitest";
import { methodLink } from "@/lib/contact-methods";

describe("methodLink", () => {
  it("dials a phone number, keeping the digits and dropping the decoration", () => {
    expect(methodLink("mobile", "+1 (555) 010-4477")).toEqual({
      kind: "tel",
      href: "tel:+15550104477",
    });
    expect(methodLink("home-phone", "07700 900461").href).toBe("tel:07700900461");
  });

  it("keeps the leading plus, which is the difference between a country and none", () => {
    expect(methodLink("mobile", "+44 7700 900461").href).toBe("tel:+447700900461");
  });

  it("keeps extension punctuation, which a phone knows how to dial", () => {
    expect(methodLink("work-phone", "555-0134 ext,,123").href).toBe("tel:5550134,,123");
  });

  it("offers no link for a phone type holding no digits", () => {
    expect(methodLink("mobile", "ask Sam")).toEqual({ kind: "tel", href: null });
    expect(methodLink("mobile", "+").href).toBeNull();
  });

  it("opens a mail client for something shaped like an address", () => {
    expect(methodLink("email", " dana@example.com ")).toEqual({
      kind: "mailto",
      href: "mailto:dana@example.com",
    });
  });

  it("declines to offer mailto for something that is not an address", () => {
    for (const value of ["dana at example.com", "dana@localhost", "@dana"]) {
      expect(methodLink("email", value).href).toBeNull();
    }
  });

  it("builds a profile URL from a handle, with or without the @", () => {
    expect(methodLink("instagram", "@dana.w").href).toBe("https://instagram.com/dana.w");
    expect(methodLink("x", "danaw").href).toBe("https://x.com/danaw");
    expect(methodLink("linkedin", "dana-whitfield").href).toBe(
      "https://linkedin.com/in/dana-whitfield",
    );
  });

  it("does not build a profile URL out of a display name", () => {
    // Appending this to a host produces a confident-looking 404.
    expect(methodLink("instagram", "Dana W (work account)").href).toBeNull();
  });

  it("treats a pasted link as the link the user meant", () => {
    expect(methodLink("instagram", "https://instagram.com/dana.w").href).toBe(
      "https://instagram.com/dana.w",
    );
    // Even under a slug with no host of its own.
    expect(methodLink("discord", "https://discord.com/users/1").kind).toBe("url");
  });

  it("does not turn a URL into a phone link when it is filed under a phone type", () => {
    expect(methodLink("mobile", "https://example.com/call").kind).toBe("tel");
  });

  it("promotes a bare domain to https for a website, but not a handle", () => {
    expect(methodLink("website", "example.com/dana").href).toBe("https://example.com/dana");
    expect(methodLink("website", "my site").href).toBeNull();
  });

  it("reaches WhatsApp and Signal by number, so the link works without the app", () => {
    expect(methodLink("whatsapp", "+1 555 010 4477")).toEqual({
      kind: "tel",
      href: "tel:+15550104477",
    });
    expect(methodLink("signal", "not a number").href).toBeNull();
  });

  it("renders as plain text when the type is missing, deleted, or renamed to something unknown", () => {
    // typeId is nullable and every slug is user-editable, so this is the
    // ordinary case rather than an error.
    expect(methodLink(null, "555-0134")).toEqual({ kind: "none", href: null });
    expect(methodLink("carrier-pigeon", "the grey one")).toEqual({ kind: "none", href: null });
  });

  it("offers nothing for an empty value", () => {
    expect(methodLink("mobile", "   ")).toEqual({ kind: "none", href: null });
  });
});
