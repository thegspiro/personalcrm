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
  str,
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
  .email("That doesn't look like an email.");

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
  if (!(await authenticatedUser(ownerId, str(form, "currentPassword"))))
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
  if (!(await authenticatedUser(ownerId, str(form, "currentPassword"))))
    return fieldError("currentPassword", "Current password is incorrect.");
  const password = str(form, "newPassword") ?? "";
  if (password !== str(form, "confirmPassword"))
    return fieldError("confirmPassword", "Those passwords don't match.");
  const strength = checkPasswordStrength(password);
  if (!strength.ok)
    return fieldError("newPassword", strength.problems.join(" "));
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: await hashPassword(password) },
  });
  await secureSessionsAfterPasswordChange(ownerId);
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
