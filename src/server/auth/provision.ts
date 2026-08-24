import "server-only";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { provisionTaxonomies } from "@/server/taxonomy/provision";
import { defaultDashboardLayout } from "@/lib/dashboard";
import { hashPassword } from "./password";
import { setAppSetting, SETUP_COMPLETED_KEY } from "@/server/db/settings";

export interface CreateAccountInput {
  email: string;
  name: string;
  password: string;
  timezone?: string;
  role?: UserRole;
}

/**
 * Create a user together with everything an account needs to be usable:
 * starter taxonomies, preferences, and a default dashboard layout. All in one
 * transaction so a half-provisioned account can never exist.
 */
export async function createAccount(input: CreateAccountInput): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim().toLowerCase();

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash,
        role: input.role ?? "MEMBER",
      },
    });

    await tx.userPreference.create({
      data: {
        userId: created.id,
        timezone: input.timezone?.trim() || process.env.TZ || "America/New_York",
      },
    });

    await tx.dashboardLayout.create({
      data: {
        userId: created.id,
        widgets: defaultDashboardLayout() as never,
      },
    });

    await provisionTaxonomies(tx, created.id);

    return created;
  });

  await setAppSetting(SETUP_COMPLETED_KEY, true);
  return user;
}

/** True when no account exists yet, i.e. the first-run wizard should show. */
export async function needsFirstRunSetup(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

export async function signupsAllowed(): Promise<boolean> {
  if ((process.env.DISABLE_SIGNUP ?? "").toLowerCase() === "true") return false;
  return true;
}
