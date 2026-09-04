"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  type ActionResult,
  bool,
  fail,
  fieldError,
  invalid,
  num,
  ok,
  owner,
  str,
} from "./helpers";
import { ACCENTS } from "@/components/providers/theme-provider";
import { isUnit } from "@/lib/geo";
// A "use server" module may only export async functions, so the candidate shape
// lives beside the provider table.
import type { GeoCandidateView } from "@/server/geo/providers";

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
      ...(timezone ? { timezone } : {}),
    },
  });

  revalidatePath("/", "layout");
  return ok();
}

const homeBaseSchema = z.object({
  homeAddress: z.string().trim().max(500).optional(),
  homeCity: z.string().trim().max(120).optional(),
  homeRegion: z.string().trim().max(120).optional(),
  homeCountry: z.string().trim().max(120).optional(),
  homeLatitude: z.coerce.number().min(-90).max(90).optional(),
  homeLongitude: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * Where you measure from.
 *
 * On the preference row rather than in `Location` deliberately: a home is the
 * point distances are counted from, not a venue with a history, and putting it
 * in the places list would file your own house among the restaurants.
 *
 * Nothing here is required. An account that never sets it simply never sees a
 * distance, which is what every installation looks like the day it upgrades.
 */
export async function updateHomeBase(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const parsed = homeBaseSchema.safeParse({
    homeAddress: str(form, "homeAddress"),
    homeCity: str(form, "homeCity"),
    homeRegion: str(form, "homeRegion"),
    homeCountry: str(form, "homeCountry"),
    homeLatitude: str(form, "homeLatitude"),
    homeLongitude: str(form, "homeLongitude"),
  });
  if (!parsed.success) return invalid(parsed.error);

  // A latitude on its own is a point on the prime meridian, not a home. Said
  // out loud rather than dropped, so somebody who meant to place their home
  // learns that they have not.
  const { homeLatitude, homeLongitude } = parsed.data;
  if ((homeLatitude === undefined) !== (homeLongitude === undefined)) {
    return fieldError(
      homeLatitude === undefined ? "homeLatitude" : "homeLongitude",
      "Give both a latitude and a longitude, or neither.",
    );
  }

  const unit = str(form, "distanceUnit");
  if (unit && !isUnit(unit)) return fail("Pick miles or kilometres.");

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: {
      homeAddress: parsed.data.homeAddress ?? null,
      homeCity: parsed.data.homeCity ?? null,
      homeRegion: parsed.data.homeRegion ?? null,
      homeCountry: parsed.data.homeCountry ?? null,
      homeLatitude: homeLatitude ?? null,
      homeLongitude: homeLongitude ?? null,
      // Presence, not value — the same rule `updateDefaults` follows, so a form
      // that does not carry the unit never silently resets it.
      ...(unit ? { distanceUnit: unit } : {}),
    },
  });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Ask the configured endpoint where your home is. Writes nothing.
 *
 * Only the address typed into the form is sent — the same rule as everywhere
 * else this reaches the network.
 */
export async function lookupHomeBase(
  form: FormData,
): Promise<ActionResult<{ candidates: GeoCandidateView[] }>> {
  await owner();

  const query = str(form, "query");
  if (!query) return fail("Fill in the address first, then look it up.");

  const { searchPlaces, LOOKUP_MESSAGES } = await import("@/server/geo/lookup");
  const outcome = await searchPlaces(query);
  if (!outcome.ok) return fail(LOOKUP_MESSAGES[outcome.reason]);

  const { toCandidateView } = await import("@/server/geo/providers");
  return ok({ candidates: outcome.candidates.map(toCandidateView) });
}

/**
 * The daily digest: one message a day to every channel, once the owner's
 * local clock passes the chosen hour.
 *
 * Its own action rather than a field on the defaults form because it is the
 * one preference that makes the app *send* something unprompted — the hour
 * has to be validated, and the switch has to be reachable from the page that
 * says where reminders go, which is where anyone looking to stop them looks.
 */
export async function updateDigest(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const hour = num(form, "digestHour");
  if (hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return fieldError("digestHour", "Pick an hour of the day.");
  }

  await prisma.userPreference.update({
    where: { userId: ownerId },
    data: { digestEnabled: bool(form, "digestEnabled"), digestHour: hour },
  });

  revalidatePath("/settings");
  return ok();
}
