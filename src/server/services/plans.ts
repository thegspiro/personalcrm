import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Turning a saved plan into the thing it became.
 *
 * A plan ends by pointing at an `Interaction` rather than by being deleted, so
 * "we did this on the 4th" survives — and an interaction rather than a
 * `DateEntry` because a plan carried out with a friend never produces one of
 * those.
 *
 * Shared because there are two ways in and they must agree. Logging a date with
 * a plan picked from "From a saved idea" closes it through `createDateEntry`;
 * `completePlan` closes it for anyone else. Left inline in the dating action,
 * the second one would have had to reimplement the scoping below, and the two
 * would have drifted the first time either changed.
 */

/**
 * Close `planId` against the interaction it turned into.
 *
 * The scoping is in the `where` clause rather than in a prior read, and
 * `updateMany` is deliberate: an id from a tampered form then matches nothing
 * and quietly does nothing, instead of reaching another account's row or a plan
 * saved against a different person. A plan saved for nobody in particular is
 * fair game for anyone, which is the `contactId: null` arm.
 */
export async function closePlanAsInteraction(
  tx: Tx,
  args: {
    ownerId: string;
    planId: string;
    /** Who it was with, or null for a plan saved against nobody. */
    contactId: string | null;
    interactionId: string;
    occurredAt: Date;
  },
): Promise<void> {
  const { ownerId, planId, contactId, interactionId, occurredAt } = args;

  await tx.plan.updateMany({
    where: {
      id: planId,
      ownerId,
      OR: contactId ? [{ contactId }, { contactId: null }] : [{ contactId: null }],
    },
    data: {
      status: "DONE",
      usedAt: occurredAt,
      usedInInteractionId: interactionId,
    },
  });
}
