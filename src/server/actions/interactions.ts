"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { transact } from "@/server/db/transaction";
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
import {
  associateNotePrivacyWhere,
  associatePrivacyWhere,
  contactPrivacyWhere,
  interactionPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";
import {
  AssociateMentionStale,
  lockMentionedAssociates,
  sweepWithheldInteractionNotes,
  writeInteractionAssociateMentions,
  type InteractionAssociateMention,
} from "@/server/services/associates";
import { calendarDateInTz, plainDateToDb } from "@/lib/dates";
import { isConcurrentRowChange } from "@/lib/db-errors";
import { displayName } from "@/lib/utils";
import { listContactOptions } from "@/server/queries/contacts";
import {
  listPlaceSuggestions,
  type PlaceSuggestion,
} from "@/server/queries/locations";
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

function revalidateFor(contactIds: string[], touchedAssociates = false) {
  revalidatePath("/");
  revalidatePath("/timeline");
  revalidatePath("/people");
  revalidatePath("/locations");
  for (const id of contactIds) revalidatePath(`/people/${id}`);
  // An associate page is per associate; the layout covers every one of them
  // without collecting their ids, and only when the save wrote a note.
  if (touchedAssociates) revalidatePath("/people/friends", "layout");
}

const MENTION_LIMIT = 20;

const associateMentionSchema = z
  .array(
    z
      .object({
        associateId: z.string().min(1).optional(),
        name: z.string().trim().min(1, "Give them a name.").max(191).optional(),
        heardFromContactId: z.string().min(1, "Pick who told you."),
        content: z
          .string()
          .trim()
          .min(1, "Write what's new with them.")
          // Well inside `TEXT` even in four-byte characters, as on the
          // associate's own page.
          .max(10_000, "Keep it under 10,000 characters."),
      })
      .refine((row) => Boolean(row.associateId) !== Boolean(row.name), {
        message: "Pick someone, or give a new name — not both.",
      }),
  )
  .max(MENTION_LIMIT, `At most ${MENTION_LIMIT} at once.`);

const MENTION_STALE =
  "Someone you noted was just changed — tracked as a person, or taken out of that friend's life. Check and save again.";

/**
 * The "they talked about…" lines, checked against what the request may write.
 *
 * Each source has to be a participant in this conversation — the person who
 * said it was there — and visible: writing a note heard from a contact the
 * closed lock is hiding would put it somewhere the writer cannot reach. Each
 * existing associate has to be visible, still a note rather than a person, and
 * in the source's life, which is what puts the news on that friend's page.
 * A new name goes into the source's life when it is created.
 *
 * Read from one hidden JSON field because the rows are dynamic; parsed with a
 * schema like every other field, and bounded, because a POST body is untrusted
 * however the form built it.
 */
async function readAssociateMentions(
  ownerId: string,
  form: FormData,
  participantIds: string[],
  scope: PrivacyScope,
): Promise<{ ok: true; mentions: InteractionAssociateMention[] } | { ok: false; result: ActionResult<never> }> {
  const raw = str(form, "associateMentions");
  if (!raw) return { ok: true, mentions: [] };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, result: fail("Couldn't read the people they talked about.") };
  }
  const parsed = associateMentionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, result: fail(parsed.error.issues[0]?.message ?? "Check the people they talked about.") };
  }
  const mentions = parsed.data;
  if (mentions.length === 0) return { ok: true, mentions: [] };

  const sources = [...new Set(mentions.map((row) => row.heardFromContactId))];
  if (sources.some((id) => !participantIds.includes(id))) {
    return { ok: false, result: fail("Pick who told you from the people who were there.") };
  }
  const visibleSources = await prisma.contact.count({
    where: { ownerId, id: { in: sources }, ...contactPrivacyWhere(scope) },
  });
  if (visibleSources !== sources.length) {
    return { ok: false, result: fail("Unlock privacy before noting what a hidden person told you.") };
  }

  const existing = mentions.filter((row) => row.associateId);
  if (existing.length > 0) {
    const ids = [...new Set(existing.map((row) => row.associateId!))];
    const rows = await prisma.associate.findMany({
      where: { ownerId, id: { in: ids }, AND: [associatePrivacyWhere(scope)] },
      select: { id: true, promotedContactId: true, links: { select: { contactId: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of existing) {
      const associate = byId.get(row.associateId!);
      if (!associate) return { ok: false, result: fail("Someone you noted wasn't found.") };
      if (associate.promotedContactId) return { ok: false, result: fail(MENTION_STALE) };
      if (!associate.links.some((link) => link.contactId === row.heardFromContactId)) {
        return { ok: false, result: fail("Pick someone in the life of the friend who told you.") };
      }
    }
  }

  return {
    ok: true,
    mentions: mentions.map((row) => ({
      associateId: row.associateId,
      name: row.name,
      heardFromContactId: row.heardFromContactId,
      content: row.content,
    })),
  };
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
  const { ownerId, timezone } = await owner();

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

  const associateMentions = await readAssociateMentions(ownerId, form, contactIds, await privacyScope());
  if (!associateMentions.ok) return associateMentions.result;

  let interaction: { id: string };
  try {
    interaction = await transact(async (tx) => {
    // First, before any plain read takes a snapshot — see the function.
    await lockMentionedAssociates(tx, ownerId, associateMentions.mentions);
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
    // Dated to the day the conversation happened, in the owner's timezone —
    // an evening coffee logged as UTC would otherwise be news from tomorrow.
    await writeInteractionAssociateMentions(
      tx,
      ownerId,
      created.id,
      plainDateToDb(calendarDateInTz(parsed.data.occurredAt, timezone)),
      associateMentions.mentions,
    );
    await recomputeContactActivity(tx, contactIds);
    return created;
    });
  } catch (error) {
    // 1020 as well: the lock comes first precisely so that it is not raised,
    // but if a server still does, it means the same thing — someone named
    // here changed under the save — and the save has been rolled back whole.
    if (error instanceof AssociateMentionStale || isConcurrentRowChange(error)) {
      return fail(MENTION_STALE);
    }
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateFor(contactIds, associateMentions.mentions.length > 0);
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
  const { ownerId, timezone } = await owner();
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

  // Add-only on an edit: the notes already written from this conversation are
  // corrected on the associate's page, where every note is, so this never has
  // to diff rows the form did not render.
  const associateMentions = await readAssociateMentions(ownerId, form, parsed.data.contactIds, scope);
  if (!associateMentions.ok) return associateMentions.result;

  try {
    await transact(async (tx) => {
      // First, before any plain read takes a snapshot — see the function.
      await lockMentionedAssociates(tx, ownerId, associateMentions.mentions);
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
        data: parsed.data.contactIds.map((contactId) => ({ ownerId, interactionId: id, contactId })),
      });
      await tx.interactionMention.deleteMany({ where: { interactionId: id } });
      if (mentionedContactIds.length) {
        await tx.interactionMention.createMany({
          data: mentionedContactIds.map((contactId) => ({ ownerId, interactionId: id, contactId })),
        });
      }

      await saveCustomFieldValuesOrThrow(tx, ownerId, "INTERACTION", id, form);
      await writeInteractionAssociateMentions(
        tx,
        ownerId,
        id,
        plainDateToDb(calendarDateInTz(parsed.data.occurredAt, timezone)),
        associateMentions.mentions,
      );

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
    // 1020 as well: the lock comes first precisely so that it is not raised,
    // but if a server still does, it means the same thing — someone named
    // here changed under the save — and the save has been rolled back whole.
    if (error instanceof AssociateMentionStale || isConcurrentRowChange(error)) {
      return fail(MENTION_STALE);
    }
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateFor(
    [...new Set([...previousContactIds, ...parsed.data.contactIds])],
    associateMentions.mentions.length > 0,
  );
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
  /**
   * Places you have already been, for the "Where" box. Loaded here rather than
   * passed down for the same reason the contacts are: the timeline renders
   * hundreds of rows and none of them should carry a list for a sheet that may
   * never open.
   */
  places: PlaceSuggestion[];
  placesTruncated: boolean;
  /**
   * What was already noted about the people in their lives from this
   * conversation. Shown, not edited, in the sheet: notes are corrected on
   * the associate's page, and the edit only adds.
   */
  associateNotes: Array<{
    id: string;
    associate: { id: string; name: string };
    content: string;
    heardFrom: string | null;
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
  const { ownerId, timezone } = await owner();
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

  const [contacts, types, customFields, places, notes] = await Promise.all([
    listContactOptions(ownerId),
    listTerms(ownerId, "INTERACTION_TYPE"),
    fieldsFor(ownerId, "INTERACTION", id),
    listPlaceSuggestions(ownerId, timezone),
    prisma.associateNote.findMany({
      where: {
        ownerId,
        sourceInteractionId: id,
        ...associateNotePrivacyWhere(scope),
        associate: associatePrivacyWhere(scope),
      },
      include: {
        associate: { select: { id: true, name: true } },
        heardFrom: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
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
    places: places.items,
    placesTruncated: places.truncated,
    associateNotes: notes.map((note) => ({
      id: note.id,
      associate: { id: note.associate.id, name: note.associate.name },
      content: note.content,
      heardFrom: note.heardFrom ? displayName(note.heardFrom) : null,
    })),
  });
}

/** The people in one participant's life, for the "they talked about…" picker. */
export interface AssociateMentionOptions {
  contactId: string;
  associates: Array<{ id: string; name: string }>;
}

/**
 * Who could be talked about, for the people picked as having been there.
 *
 * A read behind `"use server"`, like `loadInteractionForEdit`, because the
 * participants change as the form is filled in and the sheet is opened from
 * pages that have no reason to carry everyone's associates. Visible contacts
 * only, visible associates only, and not promoted ones — a promoted associate
 * is a contact now, mentioned through the contact picker above.
 */
export async function loadAssociateMentionOptions(
  contactIds: string[],
): Promise<ActionResult<AssociateMentionOptions[]>> {
  const { ownerId } = await owner();
  const ids = [...new Set(Array.isArray(contactIds) ? contactIds : [])]
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 50);
  if (ids.length === 0) return ok([]);

  const scope = await privacyScope();
  const visible = await prisma.contact.findMany({
    where: { ownerId, id: { in: ids }, ...contactPrivacyWhere(scope) },
    select: { id: true },
  });
  const visibleIds = new Set(visible.map((row) => row.id));

  const links = await prisma.associateLink.findMany({
    where: {
      ownerId,
      contactId: { in: [...visibleIds] },
      associate: { AND: [associatePrivacyWhere(scope), { promotedContactId: null }] },
    },
    select: { contactId: true, associate: { select: { id: true, name: true } } },
    orderBy: [{ associate: { name: "asc" } }, { associateId: "asc" }],
    // Bounded like every picker; far more than anyone has in one friend's life.
    take: 500,
  });

  return ok(
    ids
      .filter((id) => visibleIds.has(id))
      .map((contactId) => ({
        contactId,
        associates: links
          .filter((link) => link.contactId === contactId)
          .map((link) => ({ id: link.associate.id, name: link.associate.name })),
      })),
  );
}

export async function deleteInteraction(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.interaction.findFirst({
    where: { id, ownerId, ...interactionPrivacyWhere(scope) },
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
    // Before the delete, while the conversation still says whether the lock
    // would hide it; afterwards its notes have nothing hiding them.
    await sweepWithheldInteractionNotes(tx, ownerId, [id]);
    await tx.interaction.delete({ where: { id } });
    // Deleting the most recent interaction has to roll last-contact back to the
    // one before it, not leave it pointing at something that no longer exists.
    await recomputeContactActivity(tx, contactIds);
    for (const contactId of contactIds) await resequenceDateEntries(tx, contactId);
    return contactIds;
  });

  revalidateFor(affected, true);
  return ok();
}

function clampSentiment(value: number): number {
  return Math.max(-2, Math.min(2, Math.round(value)));
}

function reachedOutByOf(value?: string): "UNSPECIFIED" | "ME" | "THEM" | "MUTUAL" {
  return value === "ME" || value === "THEM" || value === "MUTUAL" ? value : "UNSPECIFIED";
}
