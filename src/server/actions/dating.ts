"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import {
  recomputeContactActivity,
  resequenceDateEntries,
} from "@/server/services/contact-activity";
import { findTermBySlug } from "@/server/taxonomy/queries";
import { requireUnlocked } from "@/server/privacy/lock";
import {
  type ActionResult,
  bool,
  fail,
  instant,
  num,
  ok,
  owner,
  plainDate,
  str,
} from "./helpers";

/**
 * The dating layer.
 *
 * The rule that governs everything here: **a date is an interaction**. Each one
 * writes an Interaction (so it lands in the unified timeline beside every other
 * kind of contact) plus a DateEntry for the date-specific fields, then runs the
 * two Phase 2 services:
 *
 *   recomputeContactActivity — logging a date you forgot from two months ago
 *     must not read as "spoke today", which would clear them off the overdue
 *     list.
 *   resequenceDateEntries — `sequence` means "nth date with this person", so
 *     remembering a missed one renumbers the rest by when they happened rather
 *     than appending it as the newest.
 */

function touch(contactId: string) {
  revalidatePath("/");
  revalidatePath("/dating");
  revalidatePath("/dating/compare");
  revalidatePath("/timeline");
  revalidatePath(`/people/${contactId}`);
}

async function assertOwned(ownerId: string, contactId: string): Promise<boolean> {
  return Boolean(
    await prisma.contact.findFirst({ where: { id: contactId, ownerId }, select: { id: true } }),
  );
}

/**
 * Server actions are public POST endpoints, so each dating write re-checks the
 * lock. Gating only the page would leave the lock bypassable by anyone holding
 * the session cookie.
 */
async function guard(): Promise<string | null> {
  const state = await requireUnlocked();
  return state.ok ? null : state.error;
}

// --- profile ---------------------------------------------------------------

export async function upsertRomanticProfile(form: FormData): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId) return fail("Missing contact.");
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  const height = num(form, "heightCm");
  const distance = num(form, "distanceKm");
  const birthYear = num(form, "birthYear");
  const rating = num(form, "overallRating");
  const chemistry = num(form, "chemistryScore");
  const loveLanguages = form
    .getAll("loveLanguages")
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");

  await prisma.$transaction(async (tx) => {
    // Filling in a dating profile implies they belong in the pipeline.
    await tx.contact.update({ where: { id: contactId }, data: { isRomantic: true } });
    await tx.romanticProfile.upsert({
      where: { contactId },
      create: { ownerId, contactId },
      update: {},
    });
    await tx.romanticProfile.update({
      where: { contactId },
      data: {
        stageId: str(form, "stageId") ?? null,
        sourceId: str(form, "sourceId") ?? null,
        sourceDetail: str(form, "sourceDetail") ?? null,
        matchedOn: plainDate(form, "matchedOn") ?? null,
        firstDateOn: plainDate(form, "firstDateOn") ?? null,
        birthYear: birthYear && birthYear > 1900 ? Math.round(birthYear) : null,
        heightCm: height && height > 0 ? Math.round(height) : null,
        distanceKm: distance && distance >= 0 ? Math.round(distance) : null,
        livingSituation: str(form, "livingSituation") ?? null,
        relationshipStyle: str(form, "relationshipStyle") ?? null,
        wantsKids: kidsPreferenceOf(str(form, "wantsKids")),
        hasKids: form.has("hasKids") ? bool(form, "hasKids") : null,
        religion: str(form, "religion") ?? null,
        politics: str(form, "politics") ?? null,
        smoking: str(form, "smoking") ?? null,
        drinking: str(form, "drinking") ?? null,
        loveLanguages: loveLanguages.length > 0 ? (loveLanguages as never) : undefined,
        mbti: str(form, "mbti") ?? null,
        enneagram: str(form, "enneagram") ?? null,
        exclusive: bool(form, "exclusive"),
        overallRating: clampRating(rating),
        chemistryScore: clampRating(chemistry),
        privateNotes: str(form, "privateNotes") ?? null,
      },
    });
  });

  touch(contactId);
  return ok();
}

export async function setDatingStage(contactId: string, stageId: string | null): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  if (stageId) {
    const term = await prisma.taxonomyTerm.findFirst({
      where: { id: stageId, ownerId, kind: "DATING_STAGE" },
      select: { id: true },
    });
    if (!term) return fail("Unknown stage.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: contactId }, data: { isRomantic: true } });
    await tx.romanticProfile.upsert({
      where: { contactId },
      create: { ownerId, contactId, stageId },
      update: { stageId },
    });
  });

  touch(contactId);
  return ok();
}

/**
 * Wrap something up: the factual reason and the reflection are stored
 * separately, because collapsing them makes both worse.
 */
export async function endRelationship(form: FormData): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId) return fail("Missing contact.");
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  const endedStage = await findTermBySlug(ownerId, "DATING_STAGE", "ended");

  await prisma.$transaction(async (tx) => {
    await tx.romanticProfile.upsert({
      where: { contactId },
      create: { ownerId, contactId },
      update: {},
    });
    await tx.romanticProfile.update({
      where: { contactId },
      data: {
        endedOn: plainDate(form, "endedOn") ?? new Date(),
        endedReason: str(form, "endedReason") ?? null,
        retrospective: str(form, "retrospective") ?? null,
        exclusive: false,
        ...(endedStage ? { stageId: endedStage.id } : {}),
      },
    });
  });

  touch(contactId);
  return ok();
}

/**
 * Drop the romantic layer but keep everything logged.
 *
 * Nothing is destroyed by a status change: the profile, every date, every flag
 * and every note survive, so re-flagging them later restores the history. Only
 * `isRomantic` changes, which is what the pipeline filters on.
 */
export async function convertToFriend(contactId: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  await prisma.contact.update({ where: { id: contactId }, data: { isRomantic: false } });

  touch(contactId);
  return ok();
}

// --- dates -----------------------------------------------------------------

export async function createDateEntry(form: FormData): Promise<ActionResult<{ id: string }>> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId) return fail("Missing contact.");
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  const occurredAt = instant(form, "occurredAt") ?? new Date();
  const dateType = await findTermBySlug(ownerId, "INTERACTION_TYPE", "date");
  const cost = num(form, "cost");
  const venue = str(form, "venue");
  const rating = clampRating(num(form, "rating"));

  const entry = await prisma.$transaction(async (tx) => {
    await ensureProfileTx(tx, ownerId, contactId);

    const interaction = await tx.interaction.create({
      data: {
        ownerId,
        typeId: dateType?.id ?? null,
        occurredAt,
        title: venue ? `Date — ${venue}` : "Date",
        notes: str(form, "notes") ?? null,
        location: venue ?? null,
        // A rating maps onto the shared sentiment scale so dates read
        // consistently alongside everything else in the timeline.
        sentiment: rating === null ? null : rating >= 4 ? 2 : rating >= 3 ? 1 : 0,
        isPrivate: bool(form, "isPrivate"),
        participants: { create: [{ contactId }] },
      },
    });

    const created = await tx.dateEntry.create({
      data: {
        ownerId,
        contactId,
        interactionId: interaction.id,
        activityTypeId: str(form, "activityTypeId") ?? null,
        venue: venue ?? null,
        city: str(form, "city") ?? null,
        whoPaid: whoPaidOf(str(form, "whoPaid")),
        costCents: cost === undefined ? null : Math.round(cost * 100),
        rating,
        chemistry: clampRating(num(form, "chemistry")),
        conversationQuality: clampRating(num(form, "conversationQuality")),
        notes: str(form, "notes") ?? null,
      },
    });

    // Order matters only in that both must run: the first keeps the cadence
    // honest when this date is backdated, the second renumbers if it landed
    // between two existing ones.
    await recomputeContactActivity(tx, [contactId]);
    await resequenceDateEntries(tx, contactId);

    // The first date doubles as the profile's firstDateOn when unset.
    await backfillFirstDate(tx, contactId);
    return created;
  });

  touch(contactId);
  return ok({ id: entry.id });
}

export async function updateDateEntry(form: FormData): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing date.");

  const existing = await prisma.dateEntry.findFirst({
    where: { id, ownerId },
    select: { id: true, contactId: true, interactionId: true },
  });
  if (!existing) return fail("Not found.");

  const occurredAt = instant(form, "occurredAt");
  const cost = num(form, "cost");
  const venue = str(form, "venue");
  const rating = clampRating(num(form, "rating"));

  await prisma.$transaction(async (tx) => {
    await tx.dateEntry.update({
      where: { id },
      data: {
        activityTypeId: str(form, "activityTypeId") ?? null,
        venue: venue ?? null,
        city: str(form, "city") ?? null,
        whoPaid: whoPaidOf(str(form, "whoPaid")),
        costCents: cost === undefined ? null : Math.round(cost * 100),
        rating,
        chemistry: clampRating(num(form, "chemistry")),
        conversationQuality: clampRating(num(form, "conversationQuality")),
        notes: str(form, "notes") ?? null,
      },
    });

    await tx.interaction.update({
      where: { id: existing.interactionId },
      data: {
        ...(occurredAt ? { occurredAt } : {}),
        title: venue ? `Date — ${venue}` : "Date",
        notes: str(form, "notes") ?? null,
        location: venue ?? null,
        sentiment: rating === null ? null : rating >= 4 ? 2 : rating >= 3 ? 1 : 0,
      },
    });

    // Moving a date in time can change both which date it was and whether it
    // is still the most recent contact.
    await recomputeContactActivity(tx, [existing.contactId]);
    await resequenceDateEntries(tx, existing.contactId);
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteDateEntry(id: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const existing = await prisma.dateEntry.findFirst({
    where: { id, ownerId },
    select: { contactId: true, interactionId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.$transaction(async (tx) => {
    // Delete through the interaction; the DateEntry cascades from it, so the
    // pair can never be left half-removed.
    await tx.interaction.delete({ where: { id: existing.interactionId } });
    await recomputeContactActivity(tx, [existing.contactId]);
    await resequenceDateEntries(tx, existing.contactId);
  });

  touch(existing.contactId);
  return ok();
}

// --- flags -----------------------------------------------------------------

export async function createFlag(form: FormData): Promise<ActionResult<{ id: string }>> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const text = str(form, "text");
  if (!contactId || !text) return fail("Write what you noticed.");
  if (!(await assertOwned(ownerId, contactId))) return fail("Contact not found.");

  const severity = num(form, "severity") ?? 2;
  const created = await prisma.flag.create({
    data: {
      ownerId,
      contactId,
      kind: flagKindOf(str(form, "kind")),
      text,
      severity: Math.max(1, Math.min(3, Math.round(severity))),
      noticedOn: plainDate(form, "noticedOn") ?? null,
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function deleteFlag(id: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return fail(blocked);

  const { ownerId } = await owner();
  const existing = await prisma.flag.findFirst({
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.flag.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

// --- helpers ---------------------------------------------------------------

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function ensureProfileTx(tx: Tx, ownerId: string, contactId: string) {
  await tx.contact.update({ where: { id: contactId }, data: { isRomantic: true } });
  await tx.romanticProfile.upsert({
    where: { contactId },
    create: { ownerId, contactId },
    update: {},
  });
}

/** Keep firstDateOn in step with the earliest logged date. */
async function backfillFirstDate(tx: Tx, contactId: string) {
  const earliest = await tx.dateEntry.findFirst({
    where: { contactId },
    orderBy: { sequence: "asc" },
    select: { interaction: { select: { occurredAt: true } } },
  });
  if (!earliest) return;

  const occurredAt = earliest.interaction.occurredAt;
  const asDate = new Date(
    Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate()),
  );
  await tx.romanticProfile.update({ where: { contactId }, data: { firstDateOn: asDate } });
}

function clampRating(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function whoPaidOf(value?: string): "UNSPECIFIED" | "ME" | "THEM" | "SPLIT" {
  return value === "ME" || value === "THEM" || value === "SPLIT" ? value : "UNSPECIFIED";
}

function flagKindOf(value?: string): "GREEN" | "RED" | "DEALBREAKER" {
  return value === "RED" || value === "DEALBREAKER" ? value : "GREEN";
}

function kidsPreferenceOf(
  value?: string,
): "UNKNOWN" | "WANTS" | "DOES_NOT_WANT" | "OPEN" | "HAS_AND_DONE" {
  const allowed = ["WANTS", "DOES_NOT_WANT", "OPEN", "HAS_AND_DONE"] as const;
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as (typeof allowed)[number])
    : "UNKNOWN";
}
