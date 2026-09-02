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

/** A RIFF container whose size field is honest, holding a four-byte lossless chunk. */
export const WEBP_MINIMAL = Uint8Array.from([
  ...Buffer.from("RIFF"), 16, 0, 0, 0,
  ...Buffer.from("WEBP"),
  ...Buffer.from("VP8L"), 4, 0, 0, 0,
  0x2f, 0x00, 0x00, 0x00,
]);

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
