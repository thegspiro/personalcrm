import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encrypting a secret at rest, under a key derived from `AUTH_SECRET`.
 *
 * Anything encrypted here lands in a database that ends up in whatever backup
 * the operator takes, so it is encrypted with a key derived from the
 * `authSecret` the container already provisions into `/config` — a file with
 * 0600 permissions that never leaves the host.
 *
 * This protects a secret sitting in a backup file. It does not protect against
 * someone who has both the database and `/config`, and nothing claims it does.
 *
 * Deliberately without a `server-only` marker: it is pure `node:crypto` with no
 * request context or database, and the marker would only stop it being tested
 * directly.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The HKDF `info` string separating one kind of stored secret from another.
 *
 * Two purposes must never share a key: a ciphertext written for one should not
 * decrypt under the other, so a bug that reads the wrong column fails loudly
 * rather than handing back somebody's SMTP password as an API key.
 *
 * **These strings are load-bearing and permanent.** Changing one makes every
 * value already stored under it undecryptable, and the callers are written to
 * treat that as "no secret configured" or as a delivery failure — neither of
 * which points at the rename that caused it.
 */
export type SecretPurpose = "personalcrm-api-key" | "personalcrm-channel-secret";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short to derive an encryption key from.");
  }
  return value;
}

/**
 * A separate key per purpose.
 *
 * Derived rather than used directly so the value that signs sessions is never
 * also the value that encrypts stored secrets — compromising one should not
 * hand over the other.
 */
function encryptionKey(purpose: SecretPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", secret(), purpose, "aes-256-gcm", 32));
}

/** Encrypt a value. The result is safe to store as plain text. */
export function encryptSecret(plaintext: string, purpose: SecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(purpose), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

/**
 * Decrypt a stored value, or null if it cannot be read.
 *
 * Returns null rather than throwing on a wrong secret or tampered payload.
 * What that *means* is the caller's to decide, and the two callers here decide
 * differently on purpose: a missing API key is a state the app handles, while
 * an unreadable channel secret must stop delivery rather than quietly send the
 * request without its credential.
 */
export function decryptSecret(stored: string, purpose: SecretPurpose): string | null {
  if (!stored.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, encryptionKey(purpose), iv);
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
