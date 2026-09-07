import "server-only";
import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "@/server/crypto/secrets";
import { isSecureContext } from "./session";

/**
 * The half-finished sign-in, between a correct password and a correct code.
 *
 * Deliberately **not** a `Session` row. A session that exists but is not yet
 * allowed to do anything is one that every page and every action would have to
 * remember to check, and the first one that forgets is a password-only sign-in.
 * Nothing is written to the database here at all: the state is a short-lived
 * encrypted cookie, so a session row still means what it has always meant —
 * every factor cleared.
 *
 * Encrypted rather than signed because the payload names an account. It carries
 * its own expiry inside the ciphertext as well as on the cookie, since a cookie
 * lifetime is a request from the server that the client is free to ignore.
 */

const COOKIE = "pcrm_2fa";

/** Long enough to fetch a phone, short enough not to be a standing key. */
const TTL_MS = 10 * 60 * 1000;

interface Payload {
  userId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Carried through so the session records where the sign-in came from. */
  userAgent: string | null;
  ip: string | null;
}

export async function startPendingTwoFactor(payload: {
  userId: string;
  userAgent: string | null;
  ip: string | null;
}): Promise<void> {
  const expiresAt = Date.now() + TTL_MS;
  const value = encryptSecret(
    JSON.stringify({ ...payload, expiresAt } satisfies Payload),
    "personalcrm-two-factor",
  );

  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

/** Who is part-way through signing in, or null. Never trusts the clock in the cookie. */
export async function readPendingTwoFactor(): Promise<Payload | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;

  const plain = decryptSecret(raw, "personalcrm-two-factor");
  if (!plain) return null;

  try {
    const payload = JSON.parse(plain) as Payload;
    if (typeof payload.userId !== "string" || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearPendingTwoFactor(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
