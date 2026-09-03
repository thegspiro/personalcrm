"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
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
  clearLoginAttempts,
  reserveLoginAttempt,
} from "@/server/auth/login-throttle";
import {
  fail,
  fieldError,
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
  // Named, for the reason `updateEmail` below is: a bare string schema issues
  // an empty path and `invalid()` drops those, leaving a form that says to
  // check the highlighted fields and highlights none.
  if (!parsed.success)
    return fieldError(
      "name",
      parsed.error.issues[0]?.message ?? "Enter a display name.",
    );
  const { ownerId } = await owner();
  await prisma.user.updateMany({
    where: { id: ownerId },
    data: { name: parsed.data },
  });
  revalidatePath("/", "layout");
  return ok();
}

/**
 * Confirming the current password, throttled the way signing in is.
 *
 * This is reauthentication: it stands between a stolen session and the two
 * changes that would make the theft permanent — the sign-in address and the
 * password itself. Without a gate it took unlimited guesses, and each one
 * cost a bcrypt comparison, so a member of a shared instance could also spend
 * the machine's CPU at will. The attempt is reserved *before* the hash is
 * computed, because a gate that only reads yields before bcrypt and every
 * request in a burst then sees the same pre-threshold count.
 *
 * Keyed by the account and the caller's address, as sign-in is, so one
 * account under attack from one place cannot lock every other session out.
 * A correct password clears the count.
 */
type Reauthentication =
  | { ok: true }
  | { ok: false; result: ActionResult };

async function confirmPassword(
  ownerId: string,
  password: string | undefined,
): Promise<Reauthentication> {
  const refused: Reauthentication = {
    ok: false,
    result: fieldError("currentPassword", "Current password is incorrect."),
  };
  if (!password) return refused;
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return refused;

  const address = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? (await headers()).get("x-real-ip");
  const throttle = reserveLoginAttempt(user.email, address);
  if (throttle.blocked) {
    return {
      ok: false,
      result: fieldError(
        "currentPassword",
        throttle.message ?? "Too many attempts. Try again shortly.",
      ),
    };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return refused;
  clearLoginAttempts(user.email, address);
  return { ok: true };
}

export async function updateEmail(form: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(form.get("email"));
  // Named explicitly rather than passed through `invalid()`. This is a bare
  // string schema, so its issues carry an empty path, and `invalid()` drops
  // those — the form showed "Please check the highlighted fields" with nothing
  // highlighted and no word about the length or the syntax.
  if (!parsed.success)
    return fieldError(
      "email",
      parsed.error.issues[0]?.message ?? "That doesn't look like an email.",
    );
  const { ownerId } = await owner();
  const confirmed = await confirmPassword(ownerId, secret(form, "currentPassword"));
  if (!confirmed.ok) return confirmed.result;
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
  const confirmed = await confirmPassword(ownerId, secret(form, "currentPassword"));
  if (!confirmed.ok) return confirmed.result;
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
  const applyRotatedCookie = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ownerId }, data: { passwordHash } });
    return secureSessionsAfterPasswordChange(ownerId, tx);
  });
  // After the commit, never inside it. The re-keyed token only exists once the
  // transaction holding it lands, and a rollback that had already rewritten
  // the cookie would sign this browser out of an unchanged account.
  await applyRotatedCookie();
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
