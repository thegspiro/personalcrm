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

export type ImageFormat = "jpg" | "png" | "webp";

export type ImageInspection =
  | { ok: true; format: ImageFormat }
  /** `unrecognised`: not one of the formats at all. `incomplete`: one of them, but not all of it. */
  | { ok: false; reason: "unrecognised" | "incomplete" };

/** No avatar needs more; a header asking for more is a damaged file, not a large one. */
export const MAX_IMAGE_DIMENSION = 16_384;

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

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function plausible(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION;
}

/** Chunks of length, type, data and CRC; IHDR first, IEND last and final. */
function pngIsWhole(bytes: Uint8Array): boolean {
  let at = PNG_SIGNATURE.length;
  let sawHeader = false;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length) return false;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return false;
      if (!plausible(u32be(bytes, at + 8), u32be(bytes, at + 12))) return false;
      sawHeader = true;
    } else if (type === "IEND") {
      return length === 0 && end === bytes.length;
    }
    at = end;
  }
  return false;
}

/**
 * Marker segments up to the start of scan, then entropy-coded data that has
 * to end on the end-of-image marker. A frame header with real dimensions must
 * come before the scan.
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
      // Length, precision, then height and width.
      if (length < 7 || !plausible(u16be(bytes, at + 7), u16be(bytes, at + 5))) return false;
      sawFrame = true;
    }
    if (marker === 0xda) {
      return sawFrame && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    }
    at += 2 + length;
  }
  return false;
}

/** A RIFF whose declared size is the file's, holding one of the three WebP chunk kinds. */
function webpIsWhole(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  if (u32le(bytes, 4) !== bytes.length - 8) return false;
  const chunk = ascii(bytes, 12, 16);
  if (chunk !== "VP8 " && chunk !== "VP8L" && chunk !== "VP8X") return false;
  return 20 + u32le(bytes, 16) <= bytes.length;
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
