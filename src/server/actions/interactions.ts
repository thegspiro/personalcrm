"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  participantsOf,
  recomputeContactActivity,
  resequenceDateEntries,
} from "@/server/services/contact-activity";
import {
  type ActionResult,
  fail,
  instant,
  invalid,
  num,
  ok,
  owner,
  str,
  strList,
} from "./helpers";

const schema = z.object({
  contactIds: z.array(z.string().min(1)).min(1, "Pick at least one person."),
  occurredAt: z.date({ message: "When did this happen?" }),
  title: z.string().trim().max(191).optional(),
  notes: z.string().trim().optional(),
});

function revalidateFor(contactIds: string[]) {
  revalidatePath("/");
  revalidatePath("/timeline");
  revalidatePath("/people");
  for (const id of contactIds) revalidatePath(`/people/${id}`);
}

async function ownedContactIds(ownerId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, ownerId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Log an interaction.
 *
 * `occurredAt` is free — it can be minutes ago, three years ago, or next
 * Tuesday. Contact activity is always recomputed from the full history
 * afterwards rather than assigned from this row, so backfilling old history
 * never disturbs who you are currently overdue with.
 */
export async function createInteraction(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();

  const requested = strList(form, "contactIds");
  const contactIds = await ownedContactIds(ownerId, requested);
  if (contactIds.length !== requested.length) return fail("Some of those people weren't found.");

  const parsed = schema.safeParse({
    contactIds,
    occurredAt: instant(form, "occurredAt") ?? new Date(),
    title: str(form, "title"),
    notes: str(form, "notes"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const sentiment = num(form, "sentiment");
  const duration = num(form, "durationMinutes");

  const interaction = await prisma.$transaction(async (tx) => {
    const created = await tx.interaction.create({
      data: {
        ownerId,
        typeId: str(form, "typeId") ?? null,
        occurredAt: parsed.data.occurredAt,
        title: parsed.data.title ?? null,
        notes: parsed.data.notes ?? null,
        location: str(form, "location") ?? null,
        durationMinutes: duration && duration > 0 ? Math.round(duration) : null,
        sentiment: sentiment === undefined ? null : clampSentiment(sentiment),
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
      },
    });

    await recomputeContactActivity(tx, contactIds);
    return created;
  });

  revalidateFor(contactIds);
  return ok({ id: interaction.id });
}

export async function updateInteraction(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing interaction.");

  const existing = await prisma.interaction.findFirst({
    where: { id, ownerId },
    select: { id: true, participants: { select: { contactId: true } }, dateEntry: { select: { id: true } } },
  });
  if (!existing) return fail("Interaction not found.");

  const requested = strList(form, "contactIds");
  const nextContactIds = requested.length > 0 ? await ownedContactIds(ownerId, requested) : [];
  if (requested.length > 0 && nextContactIds.length !== requested.length) {
    return fail("Some of those people weren't found.");
  }

  const occurredAt = instant(form, "occurredAt");
  const sentiment = num(form, "sentiment");
  const duration = num(form, "durationMinutes");
  const previousContactIds = existing.participants.map((p) => p.contactId);

  await prisma.$transaction(async (tx) => {
    await tx.interaction.update({
      where: { id },
      data: {
        typeId: str(form, "typeId") ?? null,
        ...(occurredAt ? { occurredAt } : {}),
        title: str(form, "title") ?? null,
        notes: str(form, "notes") ?? null,
        location: str(form, "location") ?? null,
        durationMinutes: duration && duration > 0 ? Math.round(duration) : null,
        sentiment: sentiment === undefined ? null : clampSentiment(sentiment),
      },
    });

    if (nextContactIds.length > 0) {
      await tx.interactionParticipant.deleteMany({ where: { interactionId: id } });
      await tx.interactionParticipant.createMany({
        data: nextContactIds.map((contactId) => ({ interactionId: id, contactId })),
      });
    }

    // Contacts removed from the interaction need recomputing too, or they keep
    // a last-contact date from a meeting they are no longer part of.
    const affected = [...new Set([...previousContactIds, ...nextContactIds])];
    await recomputeContactActivity(tx, affected);

    // Moving an interaction in time can change which date it was.
    if (existing.dateEntry && occurredAt) {
      for (const contactId of affected) await resequenceDateEntries(tx, contactId);
    }
  });

  revalidateFor([...new Set([...previousContactIds, ...nextContactIds])]);
  return ok();
}

export async function deleteInteraction(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.interaction.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Interaction not found.");

  const affected = await prisma.$transaction(async (tx) => {
    // Read participants before the cascade removes them.
    const contactIds = await participantsOf(tx, [id]);
    await tx.interaction.delete({ where: { id } });
    // Deleting the most recent interaction has to roll last-contact back to the
    // one before it, not leave it pointing at something that no longer exists.
    await recomputeContactActivity(tx, contactIds);
    for (const contactId of contactIds) await resequenceDateEntries(tx, contactId);
    return contactIds;
  });

  revalidateFor(affected);
  return ok();
}

function clampSentiment(value: number): number {
  return Math.max(-2, Math.min(2, Math.round(value)));
}
