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
  customFieldFailure,
  deleteCustomFieldValues,
  saveCustomFieldValuesOrThrow,
} from "@/server/services/custom-field-values";
import { interactionPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { listContactOptions } from "@/server/queries/contacts";
import { fieldsFor } from "@/server/queries/custom-fields";
import { listTerms } from "@/server/taxonomy/queries";
import type { CustomFieldType } from "@prisma/client";
import { resolveLocation } from "@/server/services/locations";
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
  revalidatePath("/locations");
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
 * The submitted interaction type, once it is known to belong to this account.
 *
 * `typeId` arrives as a string in a POST body like everything else, and the
 * column is a plain foreign key: without this an id belonging to somebody
 * else's taxonomy is accepted and the row renders with a label that was never
 * theirs to use. Returns `undefined` when the id is not usable, which the
 * callers turn into a refusal rather than a silent null.
 */
async function ownedTypeId(ownerId: string, form: FormData): Promise<string | null | undefined> {
  const typeId = str(form, "typeId");
  if (!typeId) return null;
  const type = await prisma.taxonomyTerm.findFirst({
    where: { id: typeId, ownerId, kind: "INTERACTION_TYPE" },
    select: { id: true },
  });
  return type?.id;
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

  const requested = [...new Set(strList(form, "contactIds"))];
  const contactIds = await ownedContactIds(ownerId, requested);
  if (contactIds.length !== requested.length) return fail("Some of those people weren't found.");

  const parsed = schema.safeParse({
    contactIds,
    occurredAt: instant(form, "occurredAt") ?? new Date(),
    title: str(form, "title"),
    notes: str(form, "notes"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const typeId = await ownedTypeId(ownerId, form);
  if (typeId === undefined) return fail("Unknown interaction type.");

  const sentiment = num(form, "sentiment");
  const duration = num(form, "durationMinutes");
  const requestedMentions = [...new Set(strList(form, "mentionedContactIds"))]
    .filter((id) => !contactIds.includes(id));
  const mentionedContactIds = await ownedContactIds(ownerId, requestedMentions);
  if (mentionedContactIds.length !== requestedMentions.length) {
    return fail("Some mentioned people weren't found.");
  }

  let interaction: { id: string };
  try {
    interaction = await prisma.$transaction(async (tx) => {
    const place = await resolveLocation(tx, ownerId, str(form, "location"));
    const created = await tx.interaction.create({
      data: {
        ownerId,
        typeId,
        occurredAt: parsed.data.occurredAt,
        title: parsed.data.title ?? null,
        notes: parsed.data.notes ?? null,
        location: str(form, "location") ?? null,
        locationId: place?.id ?? null,
        durationMinutes: duration && duration > 0 ? Math.round(duration) : null,
        sentiment: sentiment === undefined ? null : clampSentiment(sentiment),
        reachedOutBy: reachedOutByOf(str(form, "reachedOutBy")),
        participants: { create: contactIds.map((contactId) => ({ contactId })) },
        mentions: { create: mentionedContactIds.map((contactId) => ({ contactId })) },
      },
    });

    await saveCustomFieldValuesOrThrow(tx, ownerId, "INTERACTION", created.id, form);
    await recomputeContactActivity(tx, contactIds);
    return created;
    });
  } catch (error) {
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateFor(contactIds);
  return ok({ id: interaction.id });
}

/**
 * Correct something already logged.
 *
 * Everything the log form can set, this can change — including the title,
 * which is the one quick add is most likely to get wrong: a line like "first
 * time at Sarah's place" is read for a person, a type and a date all at once,
 * and a misreading used to be uncorrectable because nothing called this.
 *
 * Validates from scratch rather than trusting the row that already exists.
 * The interaction is looked up through the privacy filter too, so an id that
 * is hidden behind a closed lock cannot be edited by guessing at it.
 */
export async function updateInteraction(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing interaction.");

  const scope = await privacyScope();
  const existing = await prisma.interaction.findFirst({
    where: { id, ownerId, ...interactionPrivacyWhere(scope) },
    select: { id: true, participants: { select: { contactId: true } }, dateEntry: { select: { id: true } } },
  });
  if (!existing) return fail("Interaction not found.");

  const requested = [...new Set(strList(form, "contactIds"))];
  const nextContactIds = await ownedContactIds(ownerId, requested);
  if (nextContactIds.length !== requested.length) {
    return fail("Some of those people weren't found.");
  }

  // The same schema the create path uses. An edit is a write like any other,
  // and a 300-character title rejected on the way in beats a database error on
  // the way out.
  const parsed = schema.safeParse({
    contactIds: nextContactIds,
    occurredAt: instant(form, "occurredAt"),
    title: str(form, "title"),
    notes: str(form, "notes"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const typeId = await ownedTypeId(ownerId, form);
  if (typeId === undefined) return fail("Unknown interaction type.");

  const sentiment = num(form, "sentiment");
  const duration = num(form, "durationMinutes");
  const requestedMentions = [...new Set(strList(form, "mentionedContactIds"))]
    .filter((contactId) => !nextContactIds.includes(contactId));
  const mentionedContactIds = await ownedContactIds(ownerId, requestedMentions);
  if (mentionedContactIds.length !== requestedMentions.length) {
    return fail("Some mentioned people weren't found.");
  }
  const previousContactIds = existing.participants.map((p) => p.contactId);

  try {
    await prisma.$transaction(async (tx) => {
      const place = await resolveLocation(tx, ownerId, str(form, "location"));
      await tx.interaction.update({
        where: { id },
        data: {
          typeId,
          occurredAt: parsed.data.occurredAt,
          title: parsed.data.title ?? null,
          notes: parsed.data.notes ?? null,
          location: str(form, "location") ?? null,
          locationId: place?.id ?? null,
          durationMinutes: duration && duration > 0 ? Math.round(duration) : null,
          sentiment: sentiment === undefined ? null : clampSentiment(sentiment),
          reachedOutBy: reachedOutByOf(str(form, "reachedOutBy")),
        },
      });

      await tx.interactionParticipant.deleteMany({ where: { interactionId: id } });
      await tx.interactionParticipant.createMany({
        data: parsed.data.contactIds.map((contactId) => ({ interactionId: id, contactId })),
      });
      await tx.interactionMention.deleteMany({ where: { interactionId: id } });
      if (mentionedContactIds.length) {
        await tx.interactionMention.createMany({
          data: mentionedContactIds.map((contactId) => ({ interactionId: id, contactId })),
        });
      }

      await saveCustomFieldValuesOrThrow(tx, ownerId, "INTERACTION", id, form);

      // Contacts removed from the interaction need recomputing too, or they keep
      // a last-contact date from a meeting they are no longer part of.
      const affected = [...new Set([...previousContactIds, ...parsed.data.contactIds])];
      await recomputeContactActivity(tx, affected);

      // Moving an interaction in time can change which date it was.
      if (existing.dateEntry) {
        for (const contactId of affected) await resequenceDateEntries(tx, contactId);
      }
    });
  } catch (error) {
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateFor([...new Set([...previousContactIds, ...parsed.data.contactIds])]);
  return ok();
}

/** Everything the edit sheet needs to render, in one round-trip. */
export interface InteractionForEdit {
  id: string;
  typeId: string | null;
  occurredAt: string;
  title: string | null;
  notes: string | null;
  location: string | null;
  durationMinutes: number | null;
  sentiment: number | null;
  reachedOutBy: string;
  contactIds: string[];
  mentionedContactIds: string[];
  contacts: Array<{ id: string; firstName: string; lastName: string | null; nickname: string | null }>;
  types: Array<{ id: string; label: string; icon: string | null; color: string | null }>;
  customFields: Array<{
    definition: {
      id: string;
      label: string;
      description: string | null;
      fieldType: CustomFieldType;
      options: unknown;
    };
    value: unknown;
  }>;
}

/**
 * Read one interaction back into a form.
 *
 * A read behind `"use server"` because the sheet is a client component and
 * fetching on open costs nothing until someone actually edits — the timeline
 * renders hundreds of rows and none of them should pay for a picker they may
 * never see. Filtered by the same privacy fragment the timeline uses, so a
 * closed lock hides a row here exactly as it hides it there.
 */
export async function loadInteractionForEdit(
  id: string,
): Promise<ActionResult<InteractionForEdit>> {
  const { ownerId } = await owner();
  if (!id) return fail("Missing interaction.");

  const scope = await privacyScope();
  const interaction = await prisma.interaction.findFirst({
    where: { id, ownerId, ...interactionPrivacyWhere(scope) },
    select: {
      id: true,
      typeId: true,
      occurredAt: true,
      title: true,
      notes: true,
      location: true,
      durationMinutes: true,
      sentiment: true,
      reachedOutBy: true,
      participants: { select: { contactId: true } },
      mentions: { select: { contactId: true } },
    },
  });
  if (!interaction) return fail("Interaction not found.");

  const [contacts, types, customFields] = await Promise.all([
    listContactOptions(ownerId),
    listTerms(ownerId, "INTERACTION_TYPE"),
    fieldsFor(ownerId, "INTERACTION", id),
  ]);

  // Someone archived, or private and currently hidden, can still be on an
  // interaction you are editing. Their id has to survive the round-trip or
  // saving would quietly drop them from the record.
  const known = new Set(contacts.map((contact) => contact.id));
  const participantIds = interaction.participants.map((p) => p.contactId);
  const mentionedContactIds = interaction.mentions.map((mention) => mention.contactId);
  const missing = [...participantIds, ...mentionedContactIds].filter(
    (contactId) => !known.has(contactId),
  );
  const extra = missing.length
    ? await prisma.contact.findMany({
        where: { id: { in: missing }, ownerId },
        select: { id: true, firstName: true, lastName: true, nickname: true },
      })
    : [];

  return ok({
    id: interaction.id,
    typeId: interaction.typeId,
    occurredAt: interaction.occurredAt.toISOString(),
    title: interaction.title,
    notes: interaction.notes,
    location: interaction.location,
    durationMinutes: interaction.durationMinutes,
    sentiment: interaction.sentiment,
    reachedOutBy: interaction.reachedOutBy,
    contactIds: participantIds,
    mentionedContactIds,
    contacts: [
      ...contacts.map((contact) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        nickname: contact.nickname,
      })),
      ...extra,
    ],
    types: types.map((type) => ({
      id: type.id,
      label: type.label,
      icon: type.icon,
      color: type.color,
    })),
    customFields: customFields.map((field) => ({
      definition: {
        id: field.definition.id,
        label: field.definition.label,
        description: field.definition.description,
        fieldType: field.definition.fieldType,
        options: field.definition.options,
      },
      value: field.value,
    })),
  });
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
    // A DateEntry cascades from its interaction, so sweep both sets of values.
    const dates = await tx.dateEntry.findMany({
      where: { interactionId: id },
      select: { id: true },
    });
    await deleteCustomFieldValues(tx, ownerId, [
      { entity: "INTERACTION", entityIds: [id] },
      { entity: "DATE_ENTRY", entityIds: dates.map((row) => row.id) },
    ]);
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

function reachedOutByOf(value?: string): "UNSPECIFIED" | "ME" | "THEM" | "MUTUAL" {
  return value === "ME" || value === "THEM" || value === "MUTUAL" ? value : "UNSPECIFIED";
}
