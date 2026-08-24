import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encrypting the API key at rest.
 *
 * The key is only stored here at all when it hasn't been supplied as an
 * environment variable, which is the preferred path. When it is stored, it
 * lands in a database that gets backed up nightly, so it is encrypted with a
 * key derived from the `authSecret` the container already provisions into
 * `/config` — a file with 0600 permissions that never leaves the host.
 *
 * This protects a key sitting in a backup file. It does not protect against
 * someone who has both the database and `/config`, and nothing claims it does.
 *
 * Deliberately without a `server-only` marker: it is pure `node:crypto` with
 * no request context or database, and the marker would only stop it being
 * tested directly. `./config.ts` is the server-only wrapper.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short to derive an encryption key from.");
  }
  return value;
}

/**
 * A separate key for this purpose.
 *
 * Derived rather than used directly so the value that signs sessions is never
 * also the value that encrypts stored secrets — compromising one should not
 * hand over the other.
 */
function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", secret(), "personalcrm-api-key", "aes-256-gcm", 32));
}

/** Encrypt a value. The result is safe to store as plain text. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

/**
 * Decrypt a stored value, or null if it cannot be read.
 *
 * Returns null rather than throwing on a wrong secret or tampered payload: the
 * caller's job is then simply to behave as though no key is configured, which
 * is a state it already handles.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // A wrong key, a truncated payload, or a failed auth tag all land here.
    return null;
  }
}

/** Constant-time comparison, for anywhere a secret is checked against input. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The last four characters, for showing which key is configured. */
export function keyHint(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}
