/**
 * The smallest complete image in each accepted format, plus deliberately
 * broken variants. The two PNGs are 1×1 pixels — one transparent, one red —
 * so a test that replaces an avatar can prove the bytes really changed.
 */

/** A copy with its own ArrayBuffer, which is what the File constructor's type asks for. */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export const PNG_TRANSPARENT = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);

export const PNG_RED = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
);

/** Start of image, a baseline frame header for 1×1, a scan header, one byte, end of image. */
export const JPEG_MINIMAL = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x00,
  0xff, 0xd9,
]);

function riff(...chunks: Array<[string, number[]]>): Uint8Array<ArrayBuffer> {
  const body = chunks.flatMap(([kind, data]) => [
    ...Buffer.from(kind),
    data.length & 0xff, (data.length >>> 8) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 24) & 0xff,
    ...data,
    ...(data.length % 2 ? [0] : []),
  ]);
  const size = body.length + 4;
  return Uint8Array.from([
    ...Buffer.from("RIFF"), size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff,
    ...Buffer.from("WEBP"),
    ...body,
  ]);
}

/** A 1×1 lossless header: the signature byte, then width-1, height-1, no alpha, version 0. */
const VP8L_1x1 = [0x2f, 0x00, 0x00, 0x00, 0x00];

/** A lossless WebP: one VP8L chunk, padded to an even length. */
export const WEBP_MINIMAL = riff(["VP8L", VP8L_1x1]);

/** A lossy WebP: frame tag, the key-frame start code, then 1×1 in 14-bit fields. */
export const WEBP_LOSSY = riff(["VP8 ", [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00]]);

/** An extended WebP: a VP8X canvas header for 1×1, then the lossless picture. */
export const WEBP_EXTENDED = riff(["VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ["VP8L", VP8L_1x1]);

/** Size-consistent, correctly named, and holding no picture at all: what the first check accepted. */
export const WEBP_EXTENDED_EMPTY = riff(["VP8X", []]);

/** Sixteen bytes of animation-frame header for a 1×1 frame at the origin. */
const ANMF_HEADER = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0];

/** An animated WebP: the extended header, then one frame holding a lossless picture. */
export const WEBP_ANIMATED = riff(
  ["VP8X", [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["ANIM", [0, 0, 0, 0, 0, 0]],
  ["ANMF", [...ANMF_HEADER, ...Buffer.from("VP8L"), 5, 0, 0, 0, ...VP8L_1x1, 0]],
);

/** An animation frame with no picture in it: a frame header alone is not a frame. */
export const WEBP_ANIMATED_EMPTY_FRAME = riff(
  ["VP8X", [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["ANIM", [0, 0, 0, 0, 0, 0]],
  ["ANMF", ANMF_HEADER],
);

/** What the second version of the check accepted: a frame chunk with nothing in it at all. */
export const WEBP_ANIMATED_NO_FRAME = riff(["VP8X", [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ["ANMF", []]);

/** A lossless chunk whose signature byte is wrong. */
export const WEBP_BAD_SIGNATURE = riff(["VP8L", [0x2e, 0x00, 0x00, 0x00, 0x00]]);

/** The PNG signature and nothing that makes it a picture: what the old check accepted. */
export const PNG_SIGNATURE_ONLY = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

export const PNG_TRUNCATED = PNG_TRANSPARENT.slice(0, PNG_TRANSPARENT.length - 4);

export const JPEG_TRUNCATED = JPEG_MINIMAL.slice(0, JPEG_MINIMAL.length - 2);

/** The size field claims more bytes than the file holds. */
export const WEBP_TRUNCATED = WEBP_MINIMAL.slice(0, WEBP_MINIMAL.length - 2);

/** A PNG whose header declares a width of zero. */
export const PNG_ZERO_WIDTH = (() => {
  const bytes = Uint8Array.from(PNG_TRANSPARENT);
  bytes.set([0, 0, 0, 0], 16);
  return bytes;
})();
