import { describe, expect, it } from "vitest";
import { inspectImage, MAX_IMAGE_DIMENSION, MAX_PNG_SIDE } from "@/lib/image-format";
import {
  JPEG_EMPTY_SCAN,
  JPEG_MINIMAL,
  JPEG_NO_SCAN,
  JPEG_TRUNCATED,
  PNG_JUNK_DATA,
  PNG_NO_DATA,
  PNG_RED,
  PNG_SHORT_STREAM,
  PNG_SPLIT_DATA,
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
  it("recognises a whole file of each accepted format", async () => {
    expect(await inspectImage(PNG_TRANSPARENT)).toEqual({ ok: true, format: "png" });
    expect(await inspectImage(PNG_RED)).toEqual({ ok: true, format: "png" });
    expect(await inspectImage(JPEG_MINIMAL)).toEqual({ ok: true, format: "jpg" });
    expect(await inspectImage(WEBP_MINIMAL)).toEqual({ ok: true, format: "webp" });
    expect(await inspectImage(WEBP_LOSSY)).toEqual({ ok: true, format: "webp" });
    expect(await inspectImage(WEBP_EXTENDED)).toEqual({ ok: true, format: "webp" });
    expect(await inspectImage(WEBP_ANIMATED)).toEqual({ ok: true, format: "webp" });
  });

  it("tells a file that is not an image from one that is not all of an image", async () => {
    expect(await inspectImage(new TextEncoder().encode("not an image"))).toEqual({ ok: false, reason: "unrecognised" });
    expect(await inspectImage(new Uint8Array(0))).toEqual({ ok: false, reason: "unrecognised" });
    // A signature alone used to pass. It is the start of a picture, not one.
    expect(await inspectImage(PNG_SIGNATURE_ONLY)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a file cut short before its terminator", async () => {
    expect(await inspectImage(PNG_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
    expect(await inspectImage(JPEG_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
    expect(await inspectImage(WEBP_TRUNCATED)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a PNG with a header and a terminator but no image data", async () => {
    expect(await inspectImage(PNG_NO_DATA)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a PNG's data to inflate to exactly the picture its header describes", async () => {
    // A byte of filler is a well-formed chunk and not a zlib stream.
    expect(await inspectImage(PNG_JUNK_DATA)).toEqual({ ok: false, reason: "incomplete" });
    // A real stream, but a scanline short.
    expect(await inspectImage(PNG_SHORT_STREAM)).toEqual({ ok: false, reason: "incomplete" });
    // The stream may be split across chunks; decoders join them, so does this.
    expect(await inspectImage(PNG_SPLIT_DATA)).toEqual({ ok: true, format: "png" });
  });

  it("refuses a PNG that would inflate to more than an avatar can be, before inflating it", async () => {
    // A 4096-square RGBA picture is more than the cap; the header alone says so.
    const huge = Uint8Array.from(PNG_TRANSPARENT);
    const side = MAX_PNG_SIDE * 2;
    huge.set([(side >>> 24) & 0xff, (side >>> 16) & 0xff, (side >>> 8) & 0xff, side & 0xff], 16);
    huge.set([(side >>> 24) & 0xff, (side >>> 16) & 0xff, (side >>> 8) & 0xff, side & 0xff], 20);
    expect(await inspectImage(huge)).toEqual({ ok: false, reason: "oversized" });
    // The cap is sized to its own arithmetic: exactly the largest allowed square passes the header check.
    const largest = Uint8Array.from(PNG_TRANSPARENT);
    largest.set([(MAX_PNG_SIDE >>> 24) & 0xff, (MAX_PNG_SIDE >>> 16) & 0xff, (MAX_PNG_SIDE >>> 8) & 0xff, MAX_PNG_SIDE & 0xff], 16);
    largest.set([(MAX_PNG_SIDE >>> 24) & 0xff, (MAX_PNG_SIDE >>> 16) & 0xff, (MAX_PNG_SIDE >>> 8) & 0xff, MAX_PNG_SIDE & 0xff], 20);
    expect(await inspectImage(largest)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses trailing bytes after the end of a PNG", async () => {
    expect(await inspectImage(Uint8Array.from([...PNG_TRANSPARENT, 0]))).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses dimensions no avatar has", async () => {
    expect(await inspectImage(PNG_ZERO_WIDTH)).toEqual({ ok: false, reason: "incomplete" });

    const huge = Uint8Array.from(PNG_TRANSPARENT);
    const width = MAX_IMAGE_DIMENSION + 1;
    huge.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
    expect(await inspectImage(huge)).toEqual({ ok: false, reason: "incomplete" });

    const jpeg = Uint8Array.from(JPEG_MINIMAL);
    jpeg.set([0, 0], 7); // frame height
    expect(await inspectImage(jpeg)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a JPEG frame header before the scan", async () => {
    const noFrame = Uint8Array.from([0xff, 0xd8, ...JPEG_MINIMAL.slice(15)]);
    expect(await inspectImage(noFrame)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a JPEG to name its components and carry scan data", async () => {
    // Markers in the right order with nothing in them used to pass on the
    // strength of the frame having been seen and the file ending on EOI.
    expect(await inspectImage(JPEG_NO_SCAN)).toEqual({ ok: false, reason: "incomplete" });
    expect(await inspectImage(JPEG_EMPTY_SCAN)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires the WebP size field to match the file", async () => {
    const lying = Uint8Array.from(WEBP_MINIMAL);
    lying[4] -= 1;
    expect(await inspectImage(lying)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("requires a WebP to carry a picture, not just a well-named chunk", async () => {
    // An extended header with nothing after it passed the first version of this check.
    expect(await inspectImage(WEBP_EXTENDED_EMPTY)).toEqual({ ok: false, reason: "incomplete" });
    expect(await inspectImage(WEBP_BAD_SIGNATURE)).toEqual({ ok: false, reason: "incomplete" });
    // An animation frame has to hold a picture of its own; its header alone is not one.
    expect(await inspectImage(WEBP_ANIMATED_NO_FRAME)).toEqual({ ok: false, reason: "incomplete" });
    expect(await inspectImage(WEBP_ANIMATED_EMPTY_FRAME)).toEqual({ ok: false, reason: "incomplete" });

    const noStartCode = Uint8Array.from(WEBP_LOSSY);
    noStartCode[23] = 0x00;
    expect(await inspectImage(noStartCode)).toEqual({ ok: false, reason: "incomplete" });

    // Chunks have to consume the file exactly: a stray byte after the padding is not a WebP.
    const trailing = Uint8Array.from([...WEBP_MINIMAL, 0]);
    trailing[4] += 1;
    expect(await inspectImage(trailing)).toEqual({ ok: false, reason: "incomplete" });
  });
});
