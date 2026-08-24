"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { clearPin, lock, requireUnlocked, setPin, unlock } from "@/server/privacy/lock";
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
  if (!result.ok) return fail(result.error ?? "That PIN is wrong.");

  revalidateEverything();
  const next = str(form, "next");
  // Only ever redirect within this app — a caller-supplied absolute URL would
  // turn the unlock form into an open redirect.
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dating");
}

export async function lockPrivacyAction(): Promise<void> {
  await lock();
  revalidateEverything();
  redirect("/");
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
  if (!result.ok) return fail(result.error ?? "Could not set that PIN.");

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
  if (!result.ok) return fail(result.error ?? "Could not remove the PIN.");

  revalidateEverything();
  return ok();
}

export async function updatePrivacyPreferences(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const wantsLock = bool(form, "privacyLockEnabled");
  if (wantsLock) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { privacyPinHash: true },
    });
    if (!user.privacyPinHash) return fail("Set a PIN before switching the lock on.");
  }

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: {
      privacyLockEnabled: wantsLock,
      hideDating: bool(form, "hideDating"),
      blurPrivateNotes: bool(form, "blurPrivateNotes"),
    },
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
    const { count } = await prisma.fact.updateMany({ where: { id, ownerId }, data: { isPrivate } });
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
