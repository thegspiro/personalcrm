/**
 * What each kind of notification channel needs to be configured.
 *
 * One table, used twice: the settings form renders from it, and the server
 * validates against it. Two hand-written lists would drift, and drift here is
 * expensive in a particular way — a channel that saves happily and then throws
 * inside the sender an hour later, in a cron job nobody is watching.
 *
 * Pure: no Prisma, no `server-only`, so it can be unit-tested and imported by
 * the client component.
 */

export const CHANNEL_KINDS = ["EMAIL", "NTFY", "GOTIFY", "DISCORD", "WEBHOOK"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export interface ChannelField {
  name: string;
  label: string;
  hint?: string;
  type: "text" | "url" | "email" | "number" | "password" | "checkbox";
  required?: boolean;
  placeholder?: string;
  /** Encrypted at rest and never sent back to the browser. */
  secret?: boolean;
}

export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  EMAIL: "Email",
  NTFY: "ntfy",
  GOTIFY: "Gotify",
  DISCORD: "Discord",
  WEBHOOK: "Webhook",
};

export const CHANNEL_BLURBS: Record<ChannelKind, string> = {
  EMAIL:
    "Sends through an SMTP server you provide. The relay's logs will hold the contents of every reminder.",
  NTFY: "Posts to an ntfy topic. Point it at your own server and nothing leaves your network.",
  GOTIFY: "Posts to a Gotify server, usually one you host yourself.",
  DISCORD: "Posts to a Discord webhook URL.",
  WEBHOOK: "Posts JSON to any URL you name — for wiring into something else.",
};

const URL_FIELDS: ChannelField[] = [
  {
    name: "url",
    label: "URL",
    type: "url",
    required: true,
    placeholder: "https://ntfy.example.com/my-topic",
  },
  {
    name: "token",
    label: "Token",
    type: "password",
    secret: true,
    hint: "Optional. Sent as a bearer token.",
  },
];

/**
 * Discord's webhook URL *is* the credential — the token sits in its path — so
 * it is stored encrypted and never sent back, unlike an ntfy topic URL which is
 * only an address. That means the settings card cannot echo it, which is the
 * point: rendering it would put the token on screen and in the page payload.
 */
const DISCORD_FIELDS: ChannelField[] = [
  {
    name: "url",
    label: "Webhook URL",
    type: "password",
    secret: true,
    hint: "Contains its own token, so it is encrypted and not shown again.",
    placeholder: "https://discord.com/api/webhooks/…",
  },
];

export const CHANNEL_FIELDS: Record<ChannelKind, ChannelField[]> = {
  EMAIL: [
    { name: "host", label: "SMTP host", type: "text", required: true, placeholder: "smtp.example.com" },
    { name: "port", label: "Port", type: "number", placeholder: "587" },
    { name: "secure", label: "Connect with TLS directly (port 465)", type: "checkbox" },
    { name: "user", label: "Username", type: "text", hint: "Optional, if the server needs a login." },
    { name: "pass", label: "Password", type: "password", secret: true },
    { name: "from", label: "From", type: "email", required: true, placeholder: "crm@example.com" },
    { name: "to", label: "To", type: "email", required: true, placeholder: "you@example.com" },
  ],
  NTFY: URL_FIELDS,
  GOTIFY: [
    {
      name: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "https://gotify.example.com/message",
    },
    {
      name: "token",
      label: "Application token",
      type: "password",
      secret: true,
      // Not optional the way ntfy's is: Gotify will not accept a message
      // without one, so a channel saved blank is a channel that never delivers.
      hint: "Required. Gotify rejects a message posted without one.",
    },
  ],
  DISCORD: DISCORD_FIELDS,
  WEBHOOK: URL_FIELDS,
};

/** The stored key holding the encrypted form of a secret field. */
export function encryptedKeyFor(field: string): string {
  return `${field}Enc`;
}

export function secretFieldsFor(kind: ChannelKind): ChannelField[] {
  return CHANNEL_FIELDS[kind].filter((field) => field.secret);
}

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}

const DEFAULT_SMTP_PORT = 587;

/** JSON-safe, because this is written straight into `NotificationChannel.config`. */
export type ChannelConfigValue = string | number | boolean;

export interface ValidationResult {
  ok: boolean;
  /** Keyed by field name, so the form can point at the input that is wrong. */
  errors: Record<string, string>;
  /** The non-secret configuration, ready to merge with the encrypted values. */
  config: Record<string, ChannelConfigValue>;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

/**
 * Validate the non-secret half of a channel's configuration.
 *
 * The sender reads this JSON back with raw `typeof` guards and throws when it
 * does not like what it finds, so anything that gets past here has to be a
 * shape it will accept. Two consequences worth naming:
 *
 * - `port` must be stored as a **number**. The sender does
 *   `typeof config.port === "number" ? config.port : 587`, so a string "2525"
 *   silently becomes 587 and mail goes to the wrong port with no error.
 * - `host`, `from` and `to` must all be present strings, or the sender throws
 *   on every send for a channel that saved without complaint.
 */
export function validateChannelConfig(
  kind: ChannelKind,
  input: Record<string, string | undefined>,
): ValidationResult {
  const errors: Record<string, string> = {};
  const config: Record<string, ChannelConfigValue> = {};

  if (kind === "EMAIL") {
    const host = input.host?.trim();
    if (!host) errors.host = "The SMTP host is required.";
    else config.host = host;

    const rawPort = input.port?.trim();
    if (rawPort) {
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.port = "The port has to be a whole number between 1 and 65535.";
      } else {
        config.port = port;
      }
    } else {
      config.port = DEFAULT_SMTP_PORT;
    }

    config.secure = input.secure === "true" || input.secure === "on";

    const user = input.user?.trim();
    if (user) config.user = user;

    for (const key of ["from", "to"] as const) {
      const value = input[key]?.trim();
      if (!value) errors[key] = `A "${key}" address is required.`;
      else if (!looksLikeEmail(value)) errors[key] = "That doesn't look like an email address.";
      else config[key] = value;
    }

    return { ok: Object.keys(errors).length === 0, errors, config };
  }

  // Where the URL is itself the credential it goes through the secret path, so
  // it is only validated here — never copied into the readable config.
  const secretUrl = CHANNEL_FIELDS[kind].some((field) => field.name === "url" && field.secret);
  const url = input.url?.trim();

  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.url = "The address should start with http:// or https://.";
      } else if (!secretUrl) {
        config.url = url;
      }
    } catch {
      errors.url = "That isn't a valid address.";
    }
  } else if (!secretUrl) {
    // A blank secret URL means "keep the stored one"; the action checks that
    // one exists, because only it can see what is already saved.
    errors.url = "A URL is required.";
  }

  return { ok: Object.keys(errors).length === 0, errors, config };
}

/**
 * Whether a URL names a private, loopback or link-local address outright.
 *
 * Pointing a channel at a box on your own network is a first-class use — it is
 * how ntfy and Gotify are meant to be run, and the privacy documentation
 * promises it — so this is not a block. It is the line where that stops being
 * every member's decision: the server makes the request and reports what came
 * back, which on a multi-account install is a way to probe the host's own
 * network from someone else's machine.
 *
 * Literal addresses only. A hostname that resolves inwards is not caught, and
 * cannot be without resolving it here — a DNS lookup inside a validator, whose
 * answer can change between the check and the request anyway. The literal form
 * is what a probe uses.
 */
export function targetsPrivateHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // IPv6 loopback and unique-local / link-local prefixes.
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;

  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.map(Number).some((n) => n > 255)) return false;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * The fixed body of a test notification.
 *
 * No interpolation, ever. Channels are configured on a page that stays
 * reachable while the privacy lock is closed, so this is the one path by which
 * a button there could push a private person's name off the machine. There is
 * nothing here to leak.
 */
export const TEST_NOTIFICATION_SUBJECT = "Personal CRM test";
export const TEST_NOTIFICATION_BODY =
  "If you're reading this, this channel works. Nothing else was sent.";
