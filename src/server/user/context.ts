import "server-only";
import { cache } from "react";
import type { User, UserPreference } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";

export interface UserContext {
  user: User;
  prefs: UserPreference;
  /** Every date calculation in the app is anchored to this. */
  timezone: string;
}

const FALLBACK_PREFS = {
  theme: "system",
  accent: "violet",
  density: "comfortable",
  weekStartsOn: 0,
  defaultCadenceDays: null,
  digestHour: 8,
  digestEnabled: true,
} as const;

/**
 * The user plus their preferences, memoised per request. Anything that needs a
 * timezone should take it from here rather than reading process.env.TZ, so the
 * server's clock never overrides the account's.
 */
export const getUserContext = cache(async (): Promise<UserContext> => {
  const user = await requireUser();

  let prefs = await prisma.userPreference.findUnique({ where: { userId: user.id } });
  if (!prefs) {
    // An account created before preferences existed, or a partial import.
    prefs = await prisma.userPreference.create({
      data: {
        userId: user.id,
        ...FALLBACK_PREFS,
        timezone: process.env.TZ || "America/New_York",
      },
    });
  }

  return { user, prefs, timezone: prefs.timezone };
});
