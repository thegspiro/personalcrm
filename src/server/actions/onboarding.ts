"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner, str } from "./helpers";

/**
 * The first-run wizard, from the server's side.
 *
 * Every step the wizard offers is also reachable from Settings, so nothing here
 * writes anything the user could not change later. What is unique to this file
 * is the two markers on UserPreference that decide whether the wizard still has
 * something to say: `onboardingCompletedAt` and `pwaInstalledAt`.
 */

/**
 * The account's display name.
 *
 * Kept apart from `updateAppearance` and `updateDefaults` in
 * src/server/actions/settings.ts because it writes to User rather than
 * UserPreference — the wizard just calls all three.
 */
export async function updateProfileName(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const name = str(form, "name");
  if (!name) return fail("What should we call you?");
  if (name.length > 120) return fail("That name is too long.");

  await prisma.user.update({ where: { id: ownerId }, data: { name } });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Close the wizard.
 *
 * Called both by finishing and by skipping — a skipped step is not an unfinished
 * one, it is a decision. Whatever is still outstanding is picked up by the setup
 * checklist on the dashboard, which derives its state from real rows rather than
 * from anything recorded here.
 *
 * Idempotent: a double submit, or a Back into an already-finished wizard, leaves
 * the original timestamp alone.
 */
export async function completeOnboarding(): Promise<ActionResult> {
  const { ownerId } = await owner();

  await prisma.userPreference.updateMany({
    where: { userId: ownerId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Record that this account installed the app to a home screen.
 *
 * A hint for the checklist, not a fact about the account: installing on a second
 * device never reaches this row, and clearing it is not something the user can
 * do. So nothing is ever gated on it — it only decides whether the checklist
 * keeps suggesting an install.
 */
export async function markPwaInstalled(): Promise<ActionResult> {
  const { ownerId } = await owner();

  await prisma.userPreference.updateMany({
    where: { userId: ownerId, pwaInstalledAt: null },
    data: { pwaInstalledAt: new Date() },
  });

  revalidatePath("/", "layout");
  return ok();
}
