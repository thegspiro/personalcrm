import {
  decryptSecret as decrypt,
  encryptSecret as encrypt,
  type SecretPurpose,
} from "@/server/crypto/secrets";

export { keyHint, secretsMatch } from "@/server/crypto/secrets";

/**
 * Encrypting the API key at rest.
 *
 * The mechanism lives in `@/server/crypto/secrets` and is shared with
 * notification channel credentials. This binds it to the API key's own HKDF
 * purpose, which is permanent: change the string and every key already stored
 * becomes undecryptable, which `./config.ts` would then report as no key being
 * configured at all.
 *
 * The wrapper also keeps this directory's promise that `src/server/ai/` can be
 * deleted whole — nothing outside it imports this file.
 */
const PURPOSE: SecretPurpose = "personalcrm-api-key";

/** Encrypt an API key. The result is safe to store as plain text. */
export function encryptSecret(plaintext: string): string {
  return encrypt(plaintext, PURPOSE);
}

/**
 * Decrypt a stored key, or null if it cannot be read.
 *
 * Null rather than a throw on a wrong secret or tampered payload: the caller's
 * job is then simply to behave as though no key is configured, which is a state
 * it already handles. That is the right answer here and the wrong one for a
 * channel credential — see `@/server/notifications/config`.
 */
export function decryptSecret(stored: string): string | null {
  return decrypt(stored, PURPOSE);
}
