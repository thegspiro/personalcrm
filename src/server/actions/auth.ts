"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createAccount, needsFirstRunSetup, signupsAllowed } from "@/server/auth/provision";
import { checkPasswordStrength, verifyPassword } from "@/server/auth/password";
import {
  clientAddressForRecord,
  clientAddressForThrottle,
} from "@/server/auth/client-address";
import { createSession, destroySession } from "@/server/auth/session";
import { clearLoginAttempts, reserveLoginAttempt } from "@/server/auth/login-throttle";
import { requiresTwoFactor, verifySecondFactor } from "@/server/auth/two-factor";
import {
  clearPendingTwoFactor,
  readPendingTwoFactor,
  startPendingTwoFactor,
} from "@/server/auth/pending-two-factor";

export interface FormState {
  error?: string;
  /** Seconds before another sign-in may be attempted, when throttled. */
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
}

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("That doesn't look like an email."),
  password: z.string().min(1, "Enter your password."),
});

const signupSchema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(120),
  email: z.string().trim().min(1, "Enter an email.").email("That doesn't look like an email."),
  password: z.string().min(1, "Choose a password."),
  timezone: z.string().trim().max(64).optional(),
});

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    // Never the leftmost `X-Forwarded-For` entry, which is whatever the caller
    // wrote. See `@/lib/client-address`.
    ip: await clientAddressForRecord(),
    throttleKey: await clientAddressForThrottle(),
  };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const meta = await requestMeta();

  // Claimed before the password is looked at, and synchronously, so a burst
  // of guesses cannot all read the same pre-threshold count and each take a
  // turn. Attempts against an address with no account are counted on the same
  // terms, because a throttle that fired only for real accounts would answer
  // the question the error message below carefully refuses to.
  const throttle = reserveLoginAttempt(email, meta.throttleKey);
  if (throttle.blocked) {
    return {
      error: throttle.message ?? "Too many sign-in attempts. Try again shortly.",
      retryAfterSeconds: throttle.retryAfterSeconds,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Same message and roughly the same work either way, so this can't be used to
  // discover which addresses have accounts.
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return { error: "That email and password don't match." };
  }
  if (!user.isActive) {
    // The claim stands: a disabled account is still an account, and letting it
    // be probed at full speed defeats the point.
    return { error: "This account has been disabled." };
  }

  clearLoginAttempts(email, meta.throttleKey);

  // The password was right, so the guess budget is spent and reset either way.
  // What happens next depends on whether a second factor stands in front of the
  // session: nothing is created here if one does, because a Session row is the
  // app's statement that every factor has been cleared, and weakening that into
  // "created but not yet allowed to do anything" would put the check on every
  // page and action instead of on this one path.
  if (await requiresTwoFactor(user.id)) {
    await startPendingTwoFactor({
      userId: user.id,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    redirect("/login/verify");
  }

  await createSession(user.id, { userAgent: meta.userAgent, ip: meta.ip });
  redirect("/");
}

/**
 * The second step: an authenticator code, or a recovery code.
 *
 * Throttled on the same counter as the password, because this is the other
 * half of the same sign-in and a six-digit code is worth far less than a
 * password to guess at unlimited speed. The pending cookie is the only thing
 * that says who is being signed in — the form cannot name an account, or this
 * would be a way to spend somebody else's attempts.
 */
export async function verifyTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const pending = await readPendingTwoFactor();
  if (!pending) {
    return { error: "That took too long. Sign in again." };
  }

  const submitted = String(formData.get("code") ?? "").trim();
  if (!submitted) return { fieldErrors: { code: "Enter the code from your authenticator." } };

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, email: true, isActive: true },
  });
  if (!user || !user.isActive) {
    await clearPendingTwoFactor();
    return { error: "Sign in again." };
  }

  const address = await clientAddressForThrottle();
  const throttle = reserveLoginAttempt(user.email, address);
  if (throttle.blocked) {
    return {
      error: throttle.message ?? "Too many attempts. Try again shortly.",
      retryAfterSeconds: throttle.retryAfterSeconds,
    };
  }

  const outcome = await verifySecondFactor(user.id, submitted);
  if (outcome !== "ok") {
    return { fieldErrors: { code: "That code is not right." } };
  }

  clearLoginAttempts(user.email, address);
  await clearPendingTwoFactor();
  await createSession(user.id, { userAgent: pending.userAgent, ip: pending.ip });
  redirect("/");
}

export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await needsFirstRunSetup())) {
    return { error: "This server has already been set up. Sign in instead." };
  }
  // Straight into the rest of the wizard rather than onto an empty dashboard.
  return registerUser(formData, "ADMIN", "/welcome");
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await needsFirstRunSetup()) return registerUser(formData, "ADMIN", "/welcome");
  if (!(await signupsAllowed())) {
    return { error: "New accounts are disabled on this server." };
  }
  // A later account gets the same wizard: it is per-user, and their preferences
  // and taxonomies are their own.
  return registerUser(formData, "MEMBER", "/welcome");
}

async function registerUser(
  formData: FormData,
  role: "ADMIN" | "MEMBER",
  redirectTo: string,
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    timezone: formData.get("timezone") ?? undefined,
  });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const strength = checkPasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return { fieldErrors: { password: strength.problems.join(" ") } };
  }

  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    return { fieldErrors: { email: "An account with that email already exists." } };
  }

  const user = await createAccount({
    email,
    name: parsed.data.name,
    password: parsed.data.password,
    timezone: parsed.data.timezone,
    role,
  });

  await createSession(user.id, await requestMeta());
  redirect(redirectTo);
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

