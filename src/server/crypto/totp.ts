import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238), and the base32 alphabet
 * authenticator apps expect (RFC 4648).
 *
 * Written out rather than taken from a package: it is a HMAC, a counter and a
 * truncation, the RFC publishes test vectors to prove it against, and a
 * dependency in the sign-in path is a dependency that can be compromised into
 * the sign-in path.
 *
 * Deliberately without a `server-only` marker, like `secrets.ts` beside it: it
 * is pure `node:crypto` with no request context or database, and the marker
 * would only put it out of reach of a test.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The step every authenticator assumes unless told otherwise. */
export const STEP_SECONDS = 30;
export const CODE_DIGITS = 6;

/**
 * How far either side of now a code is accepted.
 *
 * One step, so a phone whose clock is half a minute out still works and a code
 * entered as it rolls over is not rejected. Wider than this stops being drift
 * tolerance and starts being a longer window to guess in.
 */
export const DRIFT_STEPS = 1;

export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  // No "=" padding: authenticators accept it either way and every one of them
  // accepts it absent, whereas a stray "=" in a manually typed key is a
  // support question.
  return out;
}

export function base32Decode(input: string): Buffer {
  // Case and spacing are how a person types a key off a screen, so both are
  // forgiven here rather than at each call site.
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error("Not a base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes — the length RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * One HOTP value for a counter (RFC 4226).
 *
 * SHA-1 rather than something newer, because that is what every authenticator
 * app implements. The construction does not rest on collision resistance.
 */
function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  // JavaScript integers are exact to 2^53, and a step counter is nowhere near
  // it, so the high word is written from the float rather than needing BigInt.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

export function counterFor(at: Date, stepSeconds: number = STEP_SECONDS): number {
  return Math.floor(at.getTime() / 1000 / stepSeconds);
}

export function totpCode(
  secret: string,
  at: Date = new Date(),
  stepSeconds: number = STEP_SECONDS,
): string {
  return hotp(base32Decode(secret), counterFor(at, stepSeconds));
}

/** Constant-time, so a wrong code cannot be narrowed digit by digit. */
function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface TotpVerification {
  ok: boolean;
  /** The step the code belonged to, for the caller to store against replay. */
  step: number | null;
}

/**
 * Check a code, and say which time step it came from.
 *
 * The step is returned rather than swallowed because accepting a code is only
 * half of it: a code stays valid for its whole window, so a caller that does
 * not record the step it accepted lets the same code be replayed until the
 * window closes. `lastUsedStep` on the stored record is what closes that, and
 * this is what makes it possible.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: Date; lastUsedStep?: number | null; drift?: number } = {},
): TotpVerification {
  const candidate = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return { ok: false, step: null };

  const at = options.at ?? new Date();
  const drift = options.drift ?? DRIFT_STEPS;
  const current = counterFor(at);

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return { ok: false, step: null };
  }

  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = current + offset;
    // A step already spent is refused even when the arithmetic agrees: this is
    // the replay guard, and it has to run before the comparison rather than
    // after, or a replayed code is "correct but rejected" and the caller has no
    // way to tell that apart from a wrong one.
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;
    if (codesMatch(hotp(key, step), candidate)) return { ok: true, step };
  }

  return { ok: false, step: null };
}

/**
 * The `otpauth://` URI an authenticator imports.
 *
 * The label carries the account so somebody with several has a chance of
 * telling them apart, and the issuer is repeated as a parameter because that
 * is the part apps actually display.
 */
export function otpauthUri(secret: string, account: string, issuer = "Personal CRM"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(CODE_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The stored key, in the groups people can actually read off a screen. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
