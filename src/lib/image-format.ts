/**
 * Which of the accepted image formats a byte sequence is, judged from the
 * bytes rather than from the name or MIME type an upload arrived with.
 *
 * None of this decodes a pixel. It walks each container far enough to know
 * the file is whole — a recognised header, plausible dimensions, and the
 * terminator the format requires at the very end — so a truncated or damaged
 * upload is refused rather than published in place of the avatar it was meant
 * to replace. A file that passes may still be a malformed image; one that
 * fails is certainly not a complete one.
 */

import { inflateSync } from "node:zlib";

export type ImageFormat = "jpg" | "png" | "webp";

export type ImageInspection =
  | { ok: true; format: ImageFormat }
  /** `unrecognised`: not one of the formats at all. `incomplete`: one of them, but not all of it. */
  | { ok: false; reason: "unrecognised" | "incomplete" };

/** No avatar needs more; a header asking for more is a damaged file, not a large one. */
export const MAX_IMAGE_DIMENSION = 16_384;

/** The most a PNG's pixel data may inflate to: 4096×4096 at four bytes a pixel. */
export const MAX_PNG_RAW_BYTES = 64 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(bytes: Uint8Array, at: number): number {
  return bytes[at] * 2 ** 24 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function u32le(bytes: Uint8Array, at: number): number {
  return bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16) + bytes[at + 3] * 2 ** 24;
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) + bytes[at + 1];
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] + (bytes[at + 1] << 8);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function plausible(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION;
}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
/** Adam7: the origin and step of each interlace pass. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/**
 * How many bytes the pixel data must inflate to: one filter byte and the
 * packed samples per scanline, over every scanline — or, interlaced, over
 * every scanline of each of the seven passes. Null for a header that
 * describes no PNG at all.
 */
function pngRawSize(width: number, height: number, depth: number, colorType: number, interlace: number): number | null {
  const channels = PNG_CHANNELS[colorType];
  if (channels === undefined || !PNG_DEPTHS[colorType].includes(depth)) return null;
  const bitsPerPixel = channels * depth;
  const rowBytes = (w: number) => Math.ceil((w * bitsPerPixel) / 8) + 1;
  if (interlace === 0) return height * rowBytes(width);
  if (interlace !== 1) return null;
  let total = 0;
  for (const [x, y, xStep, yStep] of ADAM7) {
    const passWidth = width > x ? Math.ceil((width - x) / xStep) : 0;
    const passHeight = height > y ? Math.ceil((height - y) / yStep) : 0;
    if (passWidth > 0 && passHeight > 0) total += passHeight * rowBytes(passWidth);
  }
  return total;
}

/**
 * Chunks of length, type, data and CRC; IHDR first, IEND last and final, and
 * between them IDAT chunks whose concatenated payload is a zlib stream that
 * inflates to exactly the picture the header describes. That is the one
 * place this file goes beyond structure: a byte or two of filler is a
 * well-formed IDAT chunk, and only inflating it tells it from a picture.
 * The output is capped, so a stream that claims more than an avatar could
 * hold is refused rather than unpacked.
 */
function pngIsWhole(bytes: Uint8Array): boolean {
  let at = PNG_SIGNATURE.length;
  let rawSize: number | null = null;
  const data: Uint8Array[] = [];
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length) return false;
    if (rawSize === null) {
      if (type !== "IHDR" || length !== 13) return false;
      const width = u32be(bytes, at + 8);
      const height = u32be(bytes, at + 12);
      // Bit depth, colour type, then compression and filter methods, which
      // have only ever had one value each, then the interlace method.
      if (!plausible(width, height) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0) return false;
      rawSize = pngRawSize(width, height, bytes[at + 16], bytes[at + 17], bytes[at + 20]);
      if (rawSize === null || rawSize > MAX_PNG_RAW_BYTES) return false;
    } else if (type === "IDAT") {
      data.push(bytes.subarray(at + 8, at + 8 + length));
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || data.length === 0) return false;
      try {
        return inflateSync(Buffer.concat(data), { maxOutputLength: rawSize }).length === rawSize;
      } catch {
        return false;
      }
    }
    at = end;
  }
  return false;
}

/**
 * Marker segments up to the start of scan, then entropy-coded data that has
 * to end on the end-of-image marker. A frame header with real dimensions and
 * at least one component must come before the scan, the scan header must
 * name its components, and there must be some scan data before the end.
 */
function jpegIsWhole(bytes: Uint8Array): boolean {
  let at = 2;
  let sawFrame = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return false;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // A second start-of-image, or the end before any scan: not a picture.
    if (marker === 0xd8 || marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // standalone markers carry no length
      continue;
    }
    const length = u16be(bytes, at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return false;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      // Length, precision, height, width, then a component count and three bytes per component.
      if (length < 9 || !plausible(u16be(bytes, at + 7), u16be(bytes, at + 5))) return false;
      const components = bytes[at + 9];
      if (components < 1 || length !== 8 + 3 * components) return false;
      sawFrame = true;
    }
    if (marker === 0xda) {
      // Length, a component count and two bytes per component, then three
      // bytes of spectral selection; entropy-coded data follows until EOI.
      const components = bytes[at + 4];
      if (components < 1 || components > 4 || length !== 6 + 2 * components) return false;
      const dataStart = at + 2 + length;
      return sawFrame && dataStart < bytes.length - 2 &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    }
    at += 2 + length;
  }
  return false;
}

function u24le(bytes: Uint8Array, at: number): number {
  return bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16);
}

/** The header each kind of WebP bitstream chunk must open with, dimensions included. */
function webpChunkIsWhole(kind: string, bytes: Uint8Array, at: number, size: number): boolean {
  switch (kind) {
    case "ANMF": {
      // An animation frame: a 16-byte header with the frame's size, then the
      // frame's own bitstream chunks, which have to hold a picture themselves.
      if (size < 16 || !plausible(u24le(bytes, at + 6) + 1, u24le(bytes, at + 9) + 1)) return false;
      return webpChunksHoldImage(bytes, at + 16, at + size) === true;
    }
    case "VP8 ":
      // A lossy key frame: three-byte frame tag, the start code, then 14-bit dimensions.
      return size >= 10 && bytes[at + 3] === 0x9d && bytes[at + 4] === 0x01 && bytes[at + 5] === 0x2a &&
        plausible(u16le(bytes, at + 6) & 0x3fff, u16le(bytes, at + 8) & 0x3fff);
    case "VP8L": {
      // Lossless: a signature byte, then 14-bit width-1 and height-1 and a 3-bit version that must be 0.
      if (size < 5 || bytes[at] !== 0x2f) return false;
      const bits = u32le(bytes, at + 1);
      return (bits >>> 29) === 0 && plausible((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    case "VP8X":
      // Extended: flags, then 24-bit canvas width-1 and height-1.
      return size === 10 && plausible(u24le(bytes, at + 4) + 1, u24le(bytes, at + 7) + 1);
    default:
      return true;
  }
}

/**
 * Walks the chunks in `bytes[start, end)` — each padded to an even length,
 * and together consuming the range exactly — checking every bitstream chunk's
 * header. Returns whether a picture was found: a lossy or lossless bitstream,
 * or an animation frame that holds one.
 */
function webpChunksHoldImage(bytes: Uint8Array, start: number, end: number): boolean | null {
  let at = start;
  let sawImage = false;
  while (at + 8 <= end) {
    const kind = ascii(bytes, at, at + 4);
    const size = u32le(bytes, at + 4);
    const next = at + 8 + size + (size & 1);
    if (next > end) return null;
    if (!webpChunkIsWhole(kind, bytes, at + 8, size)) return null;
    if (kind === "VP8 " || kind === "VP8L" || kind === "ANMF") sawImage = true;
    at = next;
  }
  return at === end ? sawImage : null;
}

/**
 * A RIFF whose declared size is the file's, whose chunks consume it exactly,
 * whose first chunk is one of the three WebP bitstream kinds with a header
 * that parses, and which carries a picture somewhere: an extended file opens
 * with VP8X and puts the picture in a later chunk, or in animation frames.
 */
function webpIsWhole(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || u32le(bytes, 4) !== bytes.length - 8) return false;
  const first = ascii(bytes, 12, 16);
  if (first !== "VP8 " && first !== "VP8L" && first !== "VP8X") return false;
  return webpChunksHoldImage(bytes, 12, bytes.length) === true;
}

export function inspectImage(bytes: Uint8Array): ImageInspection {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return pngIsWhole(bytes) ? { ok: true, format: "png" } : { ok: false, reason: "incomplete" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return jpegIsWhole(bytes) ? { ok: true, format: "jpg" } : { ok: false, reason: "incomplete" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return webpIsWhole(bytes) ? { ok: true, format: "webp" } : { ok: false, reason: "incomplete" };
  }
  return { ok: false, reason: "unrecognised" };
}
