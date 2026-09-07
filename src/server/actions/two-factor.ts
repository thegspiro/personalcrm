"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import {
  beginEnrolment,
  confirmEnrolment,
  disableTwoFactor,
  regenerateRecoveryCodes,
} from "@/server/auth/two-factor";
import { formatSecretForDisplay, otpauthUri } from "@/server/crypto/totp";
import { revokeAllOtherSessions } from "@/server/auth/session";
import { fail, ok, owner, type ActionResult } from "./helpers";
import { confirmPasswordForOwner } from "@/server/auth/reauth";

/**
 * Turning two-factor sign-in on and off.
 *
 * Every write here is behind the account password, not just the session. These
 * are the changes that decide whether a stolen session can be made permanent —
 * turning the second factor off is exactly what somebody holding a borrowed
 * laptop would do — so each one re-proves the person, on the same throttled
 * path the password change already uses.
 */

export interface EnrolmentStart {
  /** The base32 key, grouped for reading off a screen. */
  secret: string;
  /** Shown as text for manual entry, and usable as a link on a phone. */
  uri: string;
}

export async function startTwoFactorEnrolment(
  form: FormData,
): Promise<ActionResult<EnrolmentStart>> {
  const { ownerId } = await owner();
  const confirmed = await confirmPasswordForOwner(ownerId, String(form.get("password") ?? ""));
  if (!confirmed.ok) return confirmed.result;

  const secret = await beginEnrolment(ownerId);
  if (!secret) return fail("Two-factor sign-in is already on. Turn it off first.");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { email: true },
  });

  return ok({
    secret: formatSecretForDisplay(secret),
    uri: otpauthUri(secret, user.email),
  });
}

/**
 * Prove the authenticator holds the same secret, and hand back the recovery
 * codes. Nothing gates a sign-in until this succeeds: an unconfirmed row is how
 * a typo would otherwise lock somebody out permanently, on an app with no
 * password recovery.
 */
export async function confirmTwoFactorEnrolment(
  form: FormData,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const { ownerId } = await owner();
  const code = String(form.get("code") ?? "").trim();
  if (!code) return fail("Enter the code from your authenticator.");

  const recoveryCodes = await confirmEnrolment(ownerId, code);
  if (!recoveryCodes) return fail("That code is not right. Check the time on your phone and try again.");

  revalidatePath("/settings");
  return ok({ recoveryCodes });
}

export async function regenerateTwoFactorRecoveryCodes(
  form: FormData,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const { ownerId } = await owner();
  const confirmed = await confirmPasswordForOwner(ownerId, String(form.get("password") ?? ""));
  if (!confirmed.ok) return confirmed.result;

  const recoveryCodes = await regenerateRecoveryCodes(ownerId);
  if (!recoveryCodes) return fail("Two-factor sign-in is not on.");

  revalidatePath("/settings");
  return ok({ recoveryCodes });
}

export async function turnOffTwoFactor(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const confirmed = await confirmPasswordForOwner(ownerId, String(form.get("password") ?? ""));
  if (!confirmed.ok) return confirmed.result;

  await disableTwoFactor(ownerId);
  // Anything signed in elsewhere got there under the old rules. Ending those
  // makes the change take effect everywhere rather than only here.
  await revokeAllOtherSessions(ownerId);
  revalidatePath("/settings");
  return ok();
}
