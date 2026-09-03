"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "@/server/auth/password";
import {
  revokeAllOtherSessions,
  revokeOtherSession,
  secureSessionsAfterPasswordChange,
} from "@/server/auth/session";
import {
  fail,
  fieldError,
  invalid,
  ok,
  owner,
  type ActionResult,
} from "./helpers";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name.")
  .max(120, "Use at most 120 characters.");
const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter an email.")
  // Bounded to the column, so an over-long address comes back as a field
  // error rather than a length error thrown out of the update — which is not
  // the duplicate-address case below and would escape as a server error.
  .max(191, "Use at most 191 characters.")
  .email("That doesn't look like an email.");

/**
 * A password exactly as it was typed.
 *
 * `str` trims, and sign-in does not: an account whose password has a leading
 * or trailing space can sign in and then fail to confirm that same password
 * here, and a new one would be stored without the spaces its owner and their
 * password manager supplied.
 */
function secret(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function updateDisplayName(form: FormData): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(form.get("name"));
  if (!parsed.success) return invalid(parsed.error);
  const { ownerId } = await owner();
  await prisma.user.updateMany({
    where: { id: ownerId },
    data: { name: parsed.data },
  });
  revalidatePath("/", "layout");
  return ok();
}

async function authenticatedUser(
  ownerId: string,
  password: string | undefined,
) {
  if (!password) return null;
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { passwordHash: true },
  });
  return user && (await verifyPassword(password, user.passwordHash))
    ? user
    : null;
}

export async function updateEmail(form: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return invalid(parsed.error);
  const { ownerId } = await owner();
  if (!(await authenticatedUser(ownerId, secret(form, "currentPassword"))))
    return fieldError("currentPassword", "Current password is incorrect.");
  const email = parsed.data.toLowerCase();
  try {
    await prisma.user.update({ where: { id: ownerId }, data: { email } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return fieldError("email", "An account with that email already exists.");
    throw error;
  }
  revalidatePath("/", "layout");
  return ok();
}

export async function changePassword(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!(await authenticatedUser(ownerId, secret(form, "currentPassword"))))
    return fieldError("currentPassword", "Current password is incorrect.");
  const password = secret(form, "newPassword") ?? "";
  if (password !== secret(form, "confirmPassword"))
    return fieldError("confirmPassword", "Those passwords don't match.");
  const strength = checkPasswordStrength(password);
  if (!strength.ok)
    return fieldError("newPassword", strength.problems.join(" "));
  // Hashed before the transaction opens: this is deliberately slow work, and
  // it has no business holding a write lock on the row.
  const passwordHash = await hashPassword(password);
  // One commit for both. Revoking the other sessions in a second transaction
  // meant a deadlock or a dropped connection there left the new password
  // committed, every other session still signed in and this one still
  // unlocked — with the action reporting failure and the old password no
  // longer able to retry.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ownerId }, data: { passwordHash } });
    await secureSessionsAfterPasswordChange(ownerId, tx);
  });
  revalidatePath("/", "layout");
  return ok();
}

export async function revokeSession(sessionId: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!sessionId || !(await revokeOtherSession(ownerId, sessionId)))
    return fail("That session cannot be revoked.");
  revalidatePath("/settings");
  return ok();
}

export async function revokeAllSessions(): Promise<
  ActionResult<{ count: number }>
> {
  const { ownerId } = await owner();
  const count = await revokeAllOtherSessions(ownerId);
  revalidatePath("/settings");
  return ok({ count });
}
