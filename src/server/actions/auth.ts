"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createAccount, needsFirstRunSetup, signupsAllowed } from "@/server/auth/provision";
import { checkPasswordStrength, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/session";
import { clearLoginAttempts, reserveLoginAttempt } from "@/server/auth/login-throttle";

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
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
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
  const throttle = reserveLoginAttempt(email, meta.ip);
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

  clearLoginAttempts(email, meta.ip);
  await createSession(user.id, meta);
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

