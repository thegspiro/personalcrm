"use server";

import { revalidatePath } from "next/cache";
import { requireUnlocked } from "@/server/privacy/lock";
import { issueFeedToken, revokeFeed } from "@/server/services/calendar-feed";
import { fail, ok, owner, type ActionResult } from "./helpers";

/**
 * Managing the calendar subscription URL.
 *
 * Both writes are gated on the privacy lock even though the feed only ever
 * carries what a *closed* lock already shows. The gate is about the actor, not
 * the data: the URL is a durable, unattended read channel that keeps working
 * long after the browser is closed, and minting one is exactly the move
 * somebody would make with a borrowed unlocked phone. The lock is this app's
 * "prove it is you", so it stands in front of that — the same reasoning as the
 * dating writes, which are also lock-gated rather than page-gated, because a
 * server action is an ordinary POST anyone holding the cookie can call.
 */

/**
 * Create the subscription, or replace the one that exists.
 *
 * One action for both, because an account has one address and replacing it
 * *is* how you revoke it.
 *
 * The new token is deliberately not returned. The page re-renders with it from
 * `getFeedStatus`, so returning it as well would put a bearer credential on the
 * wire a second time for a caller that has no use for it.
 */
export async function regenerateCalendarFeed(): Promise<ActionResult> {
  const guard = await requireUnlocked();
  if (!guard.ok) return fail(guard.error);

  const { ownerId } = await owner();
  await issueFeedToken(ownerId);
  revalidatePath("/settings");
  return ok();
}

export async function disableCalendarFeed(): Promise<ActionResult> {
  const guard = await requireUnlocked();
  if (!guard.ok) return fail(guard.error);

  const { ownerId } = await owner();
  await revokeFeed(ownerId);
  revalidatePath("/settings");
  return ok();
}
