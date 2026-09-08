import { describe, expect, it, vi } from "vitest";
import { qrDataUri } from "@/server/auth/enrolment-qr";
import { otpauthUri } from "@/server/crypto/totp";

const URI = otpauthUri("JBSWY3DPEHPK3PXP", "sam@example.com");

function decode(dataUri: string): string {
  return Buffer.from(dataUri.split(",")[1]!, "base64").toString("utf8");
}

describe("the enrolment code", () => {
  it("is a data URI holding an SVG, so no policy has to be relaxed for it", () => {
    // `img-src 'self' data: blob:` already allows this, and an <img> keeps it
    // out of dangerouslySetInnerHTML entirely.
    return qrDataUri(URI).then((result) => {
      expect(result).not.toBeNull();
      expect(result!.startsWith("data:image/svg+xml;base64,")).toBe(true);
      expect(decode(result!).startsWith("<svg")).toBe(true);
    });
  });

  it("never echoes the URI into the markup, so there is nothing to escape", async () => {
    const svg = decode((await qrDataUri(URI))!);
    expect(svg).not.toContain("otpauth");
    expect(svg).not.toContain("sam@example.com");
    expect(svg).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("keeps a white background in both themes, because a scanner wants it", async () => {
    // Inverting a code to suit a dark page is how you make one some scanners
    // refuse.
    expect(decode((await qrDataUri(URI))!)).toContain('fill="#ffffff"');
  });

  it("encodes different secrets differently", async () => {
    const other = otpauthUri("KRSXG5CTMVRXEZLU", "sam@example.com");
    expect(await qrDataUri(URI)).not.toBe(await qrDataUri(other));
  });

  it("returns null rather than throwing when it cannot draw one", async () => {
    // Enrolment shows the typed key beside this, so losing the picture is a
    // worse experience and not a broken one. It must never be the reason
    // somebody cannot turn a second factor on.
    const qrcode = await import("qrcode");
    const spy = vi
      .spyOn(qrcode.default, "toString")
      .mockRejectedValue(new Error("no"));
    try {
      expect(await qrDataUri(URI)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
