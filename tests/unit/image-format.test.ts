import { describe, expect, it } from "vitest";
import { inspectImage, MAX_IMAGE_DIMENSION } from "@/lib/image-format";
import {
  JPEG_MINIMAL,
  JPEG_TRUNCATED,
  PNG_NO_DATA,
  PNG_RED,
  PNG_SIGNATURE_ONLY,
  PNG_TRANSPARENT,
  PNG_TRUNCATED,
  PNG_ZERO_WIDTH,
  WEBP_ANIMATED,
  WEBP_ANIMATED_EMPTY_FRAME,
  WEBP_ANIMATED_NO_FRAME,
  WEBP_BAD_SIGNATURE,
  WEBP_EXTENDED,
  WEBP_EXTENDED_EMPTY,
  WEBP_LOSSY,
  WEBP_MINIMAL,
  WEBP_TRUNCATED,
} from "../fixtures/images";

describe("inspectImage", () => {
  it("recognises a whole file of each accepted format", () => {
    expect(inspectImage(PNG_TRANSPARENT)).toEqual({ ok: true, format: "png" });
    expect(inspectImage(PNG_RED)).toEqual({ ok: true, format: "png" });
    expect(inspectImage(JPEG_MINIMAL)).toEqual({ ok: true, format: "jpg" });
    expect(inspectImage(WEBP_MINIMAL)).toEqual({ ok: true, format: "webp" });
    expect(inspectImage(WEBP_LOSSY)).toEqual({ ok: true, format: "webp" });
    expect(inspectImage(WEBP_EXTENDED)).toEqual({ ok: true, format: "webp" });
    expect(inspectImage(WEBP_ANIMATED)).toEqual({ ok: true, format: "webp" });
  });

  it("tells a file that is not an image from one that is not all of an image", () => {
    expect(inspectImage(new TextEncoder().encode("not an image"))).toEqual({ ok: false, reason: "unrecognised" });
    expect(inspectImage(new Uint8Array(0))).toEqual({ ok: false, reason: "unrecognised" });
    // A signature alone used to pass. It is the start of a picture, not one.
    expect(inspectImage(PNG_SIGNATURE_ONLY)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a file cut short before its terminator", () => {
    expect(inspectImage(PNG_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
    expect(inspectImage(JPEG_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
    expect(inspectImage(WEBP_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a PNG with a header and a terminator but no image data", () => {
    expect(inspectImage(PNG_NO_DATA)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses trailing bytes after the end of a PNG", () => {
    expect(inspectImage(Uint8Array.from([...PNG_TRANSPARENT, 0]))).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses dimensions no avatar has", () => {
    expect(inspectImage(PNG_ZERO_WIDTH)).toEqual({ ok: false, reason: "incomplete" });

    const huge = Uint8Array.from(PNG_TRANSPARENT);
    const width = MAX_IMAGE_DIMENSION + 1;
    huge.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
    expect(inspectImage(huge)).toEqual({ ok: false, reason: "incomplete" });

    const jpeg = Uint8Array.from(JPEG_MINIMAL);
    jpeg.set([0, 0], 7); // frame height
    expect(inspectImage(jpeg)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a JPEG frame header before the scan", () => {
    const noFrame = Uint8Array.from([0xff, 0xd8, ...JPEG_MINIMAL.slice(15)]);
    expect(inspectImage(noFrame)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires the WebP size field to match the file", () => {
    const lying = Uint8Array.from(WEBP_MINIMAL);
    lying[4] -= 1;
    expect(inspectImage(lying)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a WebP to carry a picture, not just a well-named chunk", () => {
    // An extended header with nothing after it passed the first version of this check.
    expect(inspectImage(WEBP_EXTENDED_EMPTY)).toEqual({ ok: false, reason: "incomplete" });
    expect(inspectImage(WEBP_BAD_SIGNATURE)).toEqual({ ok: false, reason: "incomplete" });
    // An animation frame has to hold a picture of its own; its header alone is not one.
    expect(inspectImage(WEBP_ANIMATED_NO_FRAME)).toEqual({ ok: false, reason: "incomplete" });
    expect(inspectImage(WEBP_ANIMATED_EMPTY_FRAME)).toEqual({ ok: false, reason: "incomplete" });

    const noStartCode = Uint8Array.from(WEBP_LOSSY);
    noStartCode[23] = 0x00;
    expect(inspectImage(noStartCode)).toEqual({ ok: false, reason: "incomplete" });

    // Chunks have to consume the file exactly: a stray byte after the padding is not a WebP.
    const trailing = Uint8Array.from([...WEBP_MINIMAL, 0]);
    trailing[4] += 1;
    expect(inspectImage(trailing)).toEqual({ ok: false, reason: "incomplete" });
  });
});
