"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import {
  clearPin,
  getPrivacyState,
  lock,
  recordProtectedActivity,
  requireUnlocked,
  setPin,
  unlock,
} from "@/server/privacy/lock";
import { type ActionResult, bool, fail, ok, owner, str } from "./helpers";

function revalidateEverything() {
  // The lock changes what every page is allowed to show.
  revalidatePath("/", "layout");
}

export async function unlockPrivacyAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const pin = str(form, "pin");
  if (!pin) return fail("Enter your PIN.");

  const result = await unlock(pin);
  if (!result.ok) return fail(result.error ?? "That PIN is wrong.", result.retryAfterSeconds);

  revalidateEverything();
  const next = str(form, "next");
  // Only ever redirect within this app — a caller-supplied absolute URL would
  // turn the unlock form into an open redirect.
  redirect(
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dating",
  );
}

/**
 * Close the lock and report it, without redirecting.
 *
 * The redirecting version cannot be awaited before other client-side work,
 * because the redirect ends the turn. A deliberate lock has to reach the
 * server *first* -- before cache purging, which waits on the service worker
 * and can outlive the page -- or a lock the viewer explicitly asked for is
 * simply lost.
 */
export async function lockPrivacyNow(): Promise<ActionResult> {
  await lock();
  revalidateEverything();
  return ok();
}

export async function lockPrivacyAction(): Promise<void> {
  await lock();
  revalidateEverything();
  redirect("/");
}

/** Throttled browser heartbeat; it can extend, but never revive, an unlock. */
export async function privacyActivityHeartbeat(): Promise<
  { ok: true; expiresAt: number } | { ok: false }
> {
  return recordProtectedActivity();
}

export async function setPinAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const newPin = str(form, "newPin");
  const confirmPin = str(form, "confirmPin");
  if (!newPin) return fail("Choose a PIN.");
  if (newPin !== confirmPin) return fail("Those PINs don't match.");

  const result = await setPin(newPin, str(form, "currentPin"));
  if (!result.ok) return fail(result.error ?? "Could not set that PIN.", result.retryAfterSeconds);

  revalidateEverything();
  return ok();
}

export async function clearPinAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const pin = str(form, "currentPin");
  if (!pin) return fail("Enter your PIN to remove it.");

  const result = await clearPin(pin);
  if (!result.ok) return fail(result.error ?? "Could not remove the PIN.", result.retryAfterSeconds);

  revalidateEverything();
  return ok();
}

export async function updatePrivacyPreferences(
  form: FormData,
): Promise<ActionResult> {
  const { ownerId } = await owner();

  // The general preferences form deliberately cannot change the lock. A
  // caller can post arbitrary FormData to a server action, so accepting the
  // field here would let a locked session lower the security boundary.
  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: {
      hideDating: bool(form, "hideDating"),
      blurPrivateNotes: bool(form, "blurPrivateNotes"),
    },
  });

  revalidateEverything();
  return ok();
}

/** Change the lock boundary, requiring server-side authorization to lower it. */
export async function setPrivacyLockEnabled(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const enabled = bool(form, "enabled");

  if (enabled) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { privacyPinHash: true },
    });
    if (!user.privacyPinHash) return fail("Set a PIN before switching the lock on.");
  } else {
    const privacy = await getPrivacyState();
    if (privacy.enabled && !privacy.unlocked) {
      const currentPin = str(form, "currentPin");
      if (!currentPin) return fail("Unlock with your PIN first.");

      const verified = await unlock(currentPin);
      if (!verified.ok) return fail(verified.error ?? "That PIN is wrong.");
    }
  }

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: { privacyLockEnabled: enabled },
  });

  revalidateEverything();
  return ok();
}

/** Toggle the private marker on a contact, fact, or interaction. */
export async function setPrivate(
  entity: "contact" | "fact" | "interaction",
  id: string,
  isPrivate: boolean,
): Promise<ActionResult> {
  // Changing a privacy marker while locked would make the row vanish with no
  // way back to it, so require the lock to be open first.
  const state = await requireUnlocked();
  if (!state.ok) return fail(state.error);

  const { ownerId } = await owner();

  if (entity === "contact") {
    const { count } = await prisma.contact.updateMany({
      where: { id, ownerId },
      data: { isPrivate },
    });
    if (count === 0) return fail("Not found.");
  } else if (entity === "fact") {
    const { count } = await prisma.fact.updateMany({
      where: { id, ownerId },
      data: { isPrivate },
    });
    if (count === 0) return fail("Not found.");
  } else {
    const { count } = await prisma.interaction.updateMany({
      where: { id, ownerId },
      data: { isPrivate },
    });
    if (count === 0) return fail("Not found.");
  }

  revalidateEverything();
  return ok();
}
