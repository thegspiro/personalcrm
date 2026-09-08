/**
 * Which client an attempt is counted against.
 *
 * `X-Forwarded-For` is a list a request travels through, appended to by each
 * proxy: the leftmost entry is whatever the *original caller* said, and every
 * entry to the right of the last trusted hop is equally unverifiable. Reading
 * the leftmost — which is the obvious-looking thing to do, and what this app
 * did — hands the throttle's key straight to whoever is knocking, so varying
 * one header buys a fresh allowance on every request. That is the cheap bypass
 * `docs/privacy.md` describes as costing one attempt rather than tens of
 * thousands.
 *
 * The only entry worth anything is the one your own proxy appended, and its
 * position is counted from the right. So the app has to be told how many hops
 * it sits behind; it cannot discover this, and guessing is exactly the mistake.
 * `TRUSTED_PROXY_HOPS` is that number, and it defaults to none.
 */

/** Longest client address kept, matching the column that stores one. */
const MAX_ADDRESS = 64;

/**
 * The stand-in used when no address can be trusted.
 *
 * A constant rather than an empty string so the value is legible in a log or a
 * session row, and deliberately not null: the throttle keys on the pair, and a
 * missing half must collapse every caller onto one counter rather than none.
 */
export const UNTRUSTED_ADDRESS = "untrusted";

export function parseTrustedHops(raw: string | undefined): number {
  const value = Number((raw ?? "").trim());
  if (!Number.isInteger(value) || value < 0) return 0;
  // A chain longer than this is not a deployment, it is a header somebody is
  // padding to push the real entry off the end of what is checked.
  return Math.min(value, 8);
}

export interface ForwardHeaders {
  forwardedFor?: string | null;
  realIp?: string | null;
}

/**
 * The client address, or null when none can be trusted.
 *
 * With `hops` of zero — the default, and the right answer for an app reached
 * directly — forwarded headers are ignored outright. Legitimate traffic to a
 * direct install carries none, so any that arrives was put there by the caller.
 *
 * With one or more, the address is counted in from the right: one hop means
 * the last entry, which your proxy appended and the caller could not have
 * written. Entries to the left of it may be anything and are never read.
 * A chain shorter than configured is treated as untrusted rather than falling
 * back to the leftmost entry, because a short chain is exactly what padding a
 * spoofed header cannot produce but a misconfiguration can — and guessing in
 * the caller's favour is how this was wrong before.
 */
export function resolveClientAddress(
  headers: ForwardHeaders,
  hops: number,
): string | null {
  if (hops <= 0) return null;

  const chain = (headers.forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (chain.length >= hops) {
    return chain[chain.length - hops]!.slice(0, MAX_ADDRESS);
  }

  // Some proxies set only `X-Real-IP`. It is trustworthy on the same terms:
  // the proxy wrote it, and at zero hops it was never read at all.
  if (chain.length === 0) {
    const real = headers.realIp?.trim();
    if (real) return real.slice(0, MAX_ADDRESS);
  }

  return null;
}

/** The value to key a throttle on: a trusted address, or the shared stand-in. */
export function throttleAddress(headers: ForwardHeaders, hops: number): string {
  return resolveClientAddress(headers, hops) ?? UNTRUSTED_ADDRESS;
}
