"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createAccount, needsFirstRunSetup, signupsAllowed } from "@/server/auth/provision";
import { checkPasswordStrength, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/server/auth/session";

export interface FormState {
  error?: string;
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  // Same message and roughly the same work either way, so this can't be used to
  // discover which addresses have accounts.
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return { error: "That email and password don't match." };
  }
  if (!user.isActive) {
    return { error: "This account has been disabled." };
  }

  await createSession(user.id, await requestMeta());
  redirect("/");
}

export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await needsFirstRunSetup())) {
    return { error: "This server has already been set up. Sign in instead." };
  }
  return registerUser(formData, "ADMIN");
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await needsFirstRunSetup()) return registerUser(formData, "ADMIN");
  if (!(await signupsAllowed())) {
    return { error: "New accounts are disabled on this server." };
  }
  return registerUser(formData, "MEMBER");
}

async function registerUser(formData: FormData, role: "ADMIN" | "MEMBER"): Promise<FormState> {
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
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function currentUserAction() {
  return getCurrentUser();
}
