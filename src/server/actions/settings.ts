"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, num, ok, owner, str } from "./helpers";
import { ACCENTS } from "@/components/providers/theme-provider";

/** How the app looks and what it assumes, beyond the privacy settings. */

const DENSITIES = ["comfortable", "compact"];

export async function updateAppearance(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const accent = str(form, "accent");
  const density = str(form, "density");
  if (accent && !(ACCENTS as readonly string[]).includes(accent)) return fail("Unknown accent.");
  if (density && !DENSITIES.includes(density)) return fail("Unknown density.");

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: {
      ...(accent ? { accent } : {}),
      ...(density ? { density } : {}),
    },
  });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Defaults applied to new records.
 *
 * The default cadence only seeds the add-person form; changing it never
 * rewrites the cadence on anyone you have already added.
 */
export async function updateDefaults(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const cadence = num(form, "defaultCadenceDays");
  const weekStartsOn = num(form, "weekStartsOn");
  const timezone = str(form, "timezone");

  if (timezone) {
    // An invalid zone would silently shift every date in the app, so it is
    // checked against the platform rather than trusted.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return fail("That isn't a timezone I recognise.");
    }
  }

  // Presence, not value: an absent field is left alone, while a present-but-empty
  // one clears the cadence. Without the distinction any form that doesn't happen
  // to carry this field — the first-run wizard's earlier panels — would silently
  // wipe a cadence set somewhere else.
  const carriesCadence = form.has("defaultCadenceDays");

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: {
      ...(carriesCadence
        ? { defaultCadenceDays: cadence && cadence > 0 ? Math.round(cadence) : null }
        : {}),
      ...(weekStartsOn === 0 || weekStartsOn === 1 ? { weekStartsOn } : {}),
      ...(timezone ? { timezone } : {}),
    },
  });

  revalidatePath("/", "layout");
  return ok();
}
