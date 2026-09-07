import "server-only";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { clearLoginAttempts, reserveLoginAttempt } from "@/server/auth/login-throttle";
import { clientAddressForThrottle } from "@/server/auth/client-address";
import { fieldError, type ActionResult } from "@/server/actions/helpers";

/**
 * Confirming the current password, throttled the way signing in is.
 *
 * Deliberately **not** in a `"use server"` module. Every export of one is a
 * public POST endpoint, and this takes an account id and hands back the hash it
 * verified — as a server action it would be a way to confirm anybody's password
 * from anywhere. It lives here so the actions that need it can import it while
 * nothing outside the server can call it.
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
  // The hash that was verified, so a caller changing the password can make its
  // update conditional on the row still carrying it.
  | { ok: true; passwordHash: string }
  // `never` rather than `void`, so a refusal is assignable to whatever shape
  // the calling action returns on success.
  | { ok: false; result: ActionResult<never> };

export async function confirmPasswordForOwner(
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

  const address = await clientAddressForThrottle();
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
  return { ok: true, passwordHash: user.passwordHash };
}
