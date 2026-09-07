import "server-only";
import { headers } from "next/headers";
import { parseTrustedHops, resolveClientAddress, throttleAddress } from "@/lib/client-address";

/**
 * The client address for this request, as far as it can be trusted.
 *
 * Read once per call rather than cached: `TRUSTED_PROXY_HOPS` is fixed for the
 * life of the process, but the headers are not, and the parse is trivial.
 */
export function trustedHops(): number {
  return parseTrustedHops(process.env.TRUSTED_PROXY_HOPS);
}

async function forwardHeaders() {
  const h = await headers();
  return { forwardedFor: h.get("x-forwarded-for"), realIp: h.get("x-real-ip") };
}

/**
 * What a sign-in attempt is counted against. Never null: with nothing
 * trustworthy to key on, every caller shares one counter per address, which
 * throttles the account rather than the client. See docs/privacy.md.
 */
export async function clientAddressForThrottle(): Promise<string> {
  return throttleAddress(await forwardHeaders(), trustedHops());
}

/** What is recorded on a session, or null when nothing can be trusted. */
export async function clientAddressForRecord(): Promise<string | null> {
  return resolveClientAddress(await forwardHeaders(), trustedHops());
}
