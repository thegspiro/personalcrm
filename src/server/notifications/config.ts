import "server-only";
import type { NotificationChannel, Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/server/crypto/secrets";
import {
  CHANNEL_FIELDS,
  encryptedKeyFor,
  secretFieldsFor,
  type ChannelKind,
} from "@/lib/notification-channels";

const PURPOSE = "personalcrm-channel-secret" as const;

/** Typed as Prisma's JSON input so it can be written back without a cast. */
export type StoredConfig = Prisma.JsonObject;

export function configOf(channel: { config: unknown }): StoredConfig {
  return typeof channel.config === "object" && channel.config && !Array.isArray(channel.config)
    ? (channel.config as StoredConfig)
    : {};
}

/**
 * Merge validated non-secret values with the secrets, encrypting what is new
 * and keeping what the form left blank.
 *
 * Ciphertext goes under its own key — `passEnc`, `tokenEnc` — rather than
 * replacing the plaintext one. Encrypting in place and detecting ciphertext by
 * its `v1.` prefix looks tidier and is wrong: a bearer token that legitimately
 * begins `v1.` would be read as ciphertext, fail its auth tag, and come back
 * null. Silently, and failing towards sending the request unauthenticated.
 */
export function mergeChannelSecrets(
  kind: ChannelKind,
  config: StoredConfig,
  submitted: Record<string, string | undefined>,
  existing: StoredConfig,
): StoredConfig {
  const merged: StoredConfig = { ...config };

  for (const field of secretFieldsFor(kind)) {
    const key = encryptedKeyFor(field.name);
    // Not trimmed: the exact bytes are the credential. The caller has already
    // decided that an all-whitespace field counts as blank.
    const value = submitted[field.name];

    if (submitted[`${field.name}__clear`] === "true") continue;

    if (value) {
      merged[key] = encryptSecret(value, PURPOSE);
      continue;
    }

    // Blank means "keep what is stored" — the form never receives the value
    // back, so it has nothing to resubmit. A legacy plaintext value is carried
    // forward as ciphertext, which is the whole migration story.
    const stored = existing[key];
    if (typeof stored === "string") {
      merged[key] = stored;
    } else if (typeof existing[field.name] === "string" && existing[field.name]) {
      merged[key] = encryptSecret(existing[field.name] as string, PURPOSE);
    }
  }

  return merged;
}

export type ResolvedConfig =
  | { ok: true; config: StoredConfig }
  | { ok: false; reason: "unreadable-secret"; field: string };

/**
 * The configuration as the sender should see it, with secrets decrypted.
 *
 * **An unreadable secret is a hard failure, not a missing one.** The API-key
 * path treats a value that will not decrypt as absent, because "no assistance"
 * is a state the app handles. Copying that here would be a silent security
 * downgrade: after an `AUTH_SECRET` rotation an unreadable SMTP password means
 * nodemailer attempts an *unauthenticated* send, and an unreadable webhook
 * token means the POST goes to a third-party host with its Authorization
 * header quietly missing. Failing instead puts the reason in `ReminderLog` and
 * in front of the user, where it can be fixed.
 *
 * A plaintext value under the bare field name is still honoured — rows written
 * by hand before there was a UI, which the next save through the form rewrites
 * encrypted.
 */
export function resolveChannelSecrets(channel: {
  kind: ChannelKind;
  config: unknown;
}): ResolvedConfig {
  const stored = configOf(channel);
  const config: StoredConfig = { ...stored };

  for (const field of secretFieldsFor(channel.kind)) {
    const key = encryptedKeyFor(field.name);
    delete config[key];

    const ciphertext = stored[key];
    if (typeof ciphertext === "string" && ciphertext) {
      const plain = decryptSecret(ciphertext, PURPOSE);
      if (plain === null) return { ok: false, reason: "unreadable-secret", field: field.name };
      config[field.name] = plain;
      continue;
    }

    // Neither encrypted nor plaintext is a valid configuration: not every
    // channel needs a credential.
  }

  return { ok: true, config };
}

export interface RedactedChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  isEnabled: boolean;
  /** Non-secret values only, safe to send to the browser. */
  config: Record<string, string | number | boolean>;
  /** Which secrets are set, without saying what they are. */
  secretsSet: Record<string, boolean>;
  /**
   * True when a stored secret will not decrypt — almost always a rotated
   * `AUTH_SECRET`. Delivery is refused until it is re-entered.
   */
  unreadableSecret: boolean;
}

/**
 * Everything the settings page may know about a channel.
 *
 * A secret is never sent back, not even as a hint. The last four characters of
 * an SMTP password are worth nothing to the person who set it and something to
 * anyone reading over their shoulder.
 */
export function redactChannel(channel: NotificationChannel): RedactedChannel {
  const kind = channel.kind as ChannelKind;
  const stored = configOf(channel);
  const config: Record<string, string | number | boolean> = {};
  for (const field of CHANNEL_FIELDS[kind]) {
    if (field.secret) continue;
    const value = stored[field.name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      config[field.name] = value;
    }
  }

  const secretsSet: Record<string, boolean> = {};
  for (const field of secretFieldsFor(kind)) {
    const key = encryptedKeyFor(field.name);
    secretsSet[field.name] =
      (typeof stored[key] === "string" && stored[key] !== "") ||
      (typeof stored[field.name] === "string" && stored[field.name] !== "");
  }

  return {
    id: channel.id,
    kind,
    name: channel.name,
    isEnabled: channel.isEnabled,
    config,
    secretsSet,
    unreadableSecret: resolveChannelSecrets(channel).ok === false,
  };
}
