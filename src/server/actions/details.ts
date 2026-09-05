"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type TaxonomyKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { resolveLocation } from "@/server/services/locations";
// A "use server" module may only export async functions, so the candidate
// shape lives beside the provider table.
import type { GeoCandidateView } from "@/server/geo/providers";
import {
  contactPrivacyWhere,
  debtPrivacyWhere,
  factPrivacyWhere,
  lifeEventPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
  viaOptionalContactPrivacyWhere,
} from "@/server/privacy/filter";
import { calendarDateInTz, plainDateFromDb, plainDateToDb } from "@/lib/dates";
import { isValidPartialDateRange } from "@/lib/date-precision";
import {
  allergyCategoryOf,
  allergyStatusOf,
  dietaryKindOf,
  validAllergyCombination,
} from "@/lib/dietary";
import { parseReminderDays } from "@/lib/reminders";
import { AVAILABILITY_IMPACTS, type AvailabilityImpact } from "@/lib/happenings";
import {
  deleteFollowUpTask,
  happeningDatesOf,
  syncFollowUpTask,
} from "@/server/services/happenings";
import { planChecklistSchema } from "@/lib/plan-checklist";
import { PLAN_MINUTE_MAX, parsePlanDuration, parsePlanMinute } from "@/lib/plan-time";
import {
  type ActionResult,
  bool,
  invalid,
  fail,
  fieldError,
  num,
  ok,
  owner,
  partialDate,
  plainDate,
  str,
  strList,
} from "./helpers";

/**
 * Everything that hangs off a contact: facts, important dates, life events,
 * ideas, plans, tasks, gifts, debts, dietary needs, and relationships.
 *
 * None of these touch interaction history, so none of them recompute contact
 * activity — only interactions move the keep-in-touch clock.
 */

function touch(contactId?: string | null) {
  revalidatePath("/");
  revalidatePath("/timeline");
  if (contactId) revalidatePath(`/people/${contactId}`);
}

/**
 * Whether this contact is both yours and currently reachable.
 *
 * Ownership alone is not the check. Every `update*` and `delete*` here looks
 * its row up through `contactPrivacyWhere`, so a closed lock refuses them — but
 * the create paths asked only "is this mine", which let an id remembered from
 * an unlocked session go on attaching facts, dates, numbers and addresses to a
 * private contact while the lock was shut. A row you cannot read is not a row
 * you may write to, and this is the one place every create passes through.
 */
async function ownsContact(ownerId: string, contactId: string): Promise<boolean> {
  return Boolean(
    await prisma.contact.findFirst({
      where: { id: contactId, ownerId, ...contactPrivacyWhere(await privacyScope()) },
      select: { id: true },
    }),
  );
}

/**
 * Read a taxonomy term id out of a form, refusing one that is not this
 * account's — or is the right id under the wrong kind.
 *
 * Every action here is a public POST endpoint, so an unchecked id goes to the
 * database as-is and renders the row with a label that was never theirs to use.
 * `updateInteraction` was found with exactly this hole; `planFields` was
 * written without it. Empty means no term, which is not an error; an id that
 * does not resolve is, rather than a silent drop, because it is either
 * somebody else's row or a stale form and both deserve to be said out loud.
 */
async function termFromForm(
  ownerId: string,
  form: FormData,
  key: string,
  kind: TaxonomyKind,
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  const id = str(form, key);
  if (!id) return { ok: true, id: null };

  const term = await prisma.taxonomyTerm.findFirst({
    where: { id, ownerId, kind },
    select: { id: true },
  });
  return term ? { ok: true, id } : { ok: false };
}

const UNKNOWN_TERM = "That type isn't one of yours.";

// --- facts -----------------------------------------------------------------

export async function createFact(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const content = str(form, "content");
  if (!contactId || !content) return fail("Write something to remember.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const category = await termFromForm(ownerId, form, "categoryId", "FACT_CATEGORY");
  if (!category.ok) return fail(UNKNOWN_TERM);

  const created = await prisma.fact.create({
    data: {
      ownerId,
      contactId,
      content,
      categoryId: category.id,
      importance: clamp(num(form, "importance") ?? 1, 0, 2),
      isPrivate: bool(form, "isPrivate"),
      sourceInteractionId: str(form, "sourceInteractionId") ?? null,
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateFact(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const content = str(form, "content");
  if (!id || !content) return fail("Write something to remember.");

  // Scoped by the privacy fragment as well as the owner: a private fact is not
  // merely hidden while the lock is closed, it is out of reach, and an id
  // remembered from an unlocked session must not be a way back in.
  const scope = await privacyScope();
  const existing = await prisma.fact.findFirst({
    where: {
      id,
      ownerId,
      ...factPrivacyWhere(scope),
      ...viaContactPrivacyWhere(scope),
    },
    select: { contactId: true, isPrivate: true },
  });
  if (!existing) return fail("Not found.");

  const marker = await privacyMarker(form, existing.isPrivate);
  if (!marker.ok) return fail(marker.error);

  const category = await termFromForm(ownerId, form, "categoryId", "FACT_CATEGORY");
  if (!category.ok) return fail(UNKNOWN_TERM);

  await prisma.fact.update({
    where: { id },
    data: {
      content,
      categoryId: category.id,
      importance: clamp(num(form, "importance") ?? 1, 0, 2),
      isPrivate: marker.isPrivate,
    },
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteFact(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.fact.findFirst({
    where: { id, ownerId, ...factPrivacyWhere(scope), ...viaContactPrivacyWhere(scope) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.fact.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

// --- important dates -------------------------------------------------------

export async function createImportantDate(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const label = str(form, "label");
  const when = partialDate(form, "date");
  if (!contactId || !label || !when) return fail("A label and a date are required.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const type = await termFromForm(ownerId, form, "typeId", "DATE_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);
  const reminders = reminderPolicy(form);
  if (!reminders.ok) return fail(reminders.error);

  const created = await prisma.importantDate.create({
    data: {
      ownerId,
      contactId,
      label,
      typeId: type.id,
      date: when.date,
      precision: when.precision,
      recurrence: recurrenceOf(str(form, "recurrence")),
      notes: str(form, "notes") ?? null,
      reminderDaysBefore: reminders.value ?? Prisma.DbNull,
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateImportantDate(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing date.");
  const existing = await prisma.importantDate.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const when = partialDate(form, "date");
  const label = str(form, "label");
  if (!label || !when) return fail("A label and a date are required.");

  const type = await termFromForm(ownerId, form, "typeId", "DATE_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);
  const reminders = reminderPolicy(form);
  if (!reminders.ok) return fail(reminders.error);

  await prisma.importantDate.update({
    where: { id },
    data: {
      label,
      typeId: type.id,
      date: when.date,
      precision: when.precision,
      recurrence: recurrenceOf(str(form, "recurrence")),
      notes: str(form, "notes") ?? null,
      reminderDaysBefore: reminders.value ?? Prisma.DbNull,
    },
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteImportantDate(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.importantDate.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.importantDate.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

// --- life events -----------------------------------------------------------

export async function createLifeEvent(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const title = str(form, "title");
  const when = partialDate(form, "date");
  if (!contactId || !title || !when) return fail("A title and a date are required.");
  const requestedContactIds = [...new Set([contactId, ...strList(form, "contactIds")])];
  const ownedContacts = await prisma.contact.findMany({
    where: { ownerId, id: { in: requestedContactIds } },
    select: { id: true },
  });
  if (ownedContacts.length !== requestedContactIds.length) return fail("Contact not found.");

  const end = partialDate(form, "endDate");
  if (
    !isValidPartialDateRange(
      { date: plainDateFromDb(when.date), precision: when.precision },
      end ? { date: plainDateFromDb(end.date), precision: end.precision } : null,
    )
  ) {
    return fieldError("endDate", "End date must not be before the start date.");
  }

  const type = await termFromForm(ownerId, form, "typeId", "LIFE_EVENT_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  const created = await prisma.lifeEvent.create({
    data: {
      ownerId,
      contactId,
      title,
      typeId: type.id,
      description: str(form, "description") ?? null,
      date: when.date,
      precision: when.precision,
      endDate: end?.date ?? null,
      endPrecision: end?.precision ?? null,
      isMilestone: bool(form, "isMilestone"),
      participants: { create: requestedContactIds.map((participantId) => ({ contactId: participantId })) },
    },
  });

  requestedContactIds.forEach(touch);
  return ok({ id: created.id });
}

export async function updateLifeEvent(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing event.");
  const scope = await privacyScope();
  const existing = await prisma.lifeEvent.findFirst({
    where: {
      id,
      ownerId,
      ...lifeEventPrivacyWhere(scope),
    },
    select: { contactId: true, participants: { select: { contactId: true } } },
  });
  if (!existing) return fail("Not found.");

  const title = str(form, "title");
  const when = partialDate(form, "date");
  if (!title || !when) return fail("A title and a date are required.");
  const end = partialDate(form, "endDate");
  if (
    !isValidPartialDateRange(
      { date: plainDateFromDb(when.date), precision: when.precision },
      end ? { date: plainDateFromDb(end.date), precision: end.precision } : null,
    )
  ) {
    return fieldError("endDate", "End date must not be before the start date.");
  }

  const type = await termFromForm(ownerId, form, "typeId", "LIFE_EVENT_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  const requestedContactIds = [...new Set([existing.contactId, ...strList(form, "contactIds")])];
  const ownedContacts = await prisma.contact.findMany({
    where: { ownerId, id: { in: requestedContactIds } },
    select: { id: true },
  });
  if (ownedContacts.length !== requestedContactIds.length) return fail("Contact not found.");

  await prisma.$transaction(async (tx) => {
    await tx.lifeEvent.update({ where: { id }, data: {
      title,
      typeId: type.id,
      description: str(form, "description") ?? null,
      date: when.date,
      precision: when.precision,
      endDate: end?.date ?? null,
      endPrecision: end?.precision ?? null,
      isMilestone: bool(form, "isMilestone"),
    } });
    await tx.lifeEventParticipant.deleteMany({ where: { lifeEventId: id } });
    await tx.lifeEventParticipant.createMany({
      data: requestedContactIds.map((participantId) => ({
        ownerId,
        lifeEventId: id,
        contactId: participantId,
      })),
    });
  });

  [...new Set([...existing.participants.map((p) => p.contactId), ...requestedContactIds])].forEach(touch);
  return ok();
}

export async function deleteLifeEvent(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.lifeEvent.findFirst({
    where: {
      id,
      ownerId,
      ...lifeEventPrivacyWhere(scope),
    },
    select: { contactId: true, participants: { select: { contactId: true } } },
  });
  if (!existing) return fail("Not found.");
  await prisma.lifeEvent.delete({ where: { id } });
  [existing.contactId, ...existing.participants.map((p) => p.contactId)].forEach(touch);
  return ok();
}

// --- happenings ------------------------------------------------------------

/**
 * Informal calendar information: what someone else has on.
 *
 * The follow-up task is written in the same transaction as the happening, so an
 * edit can never leave a task asking about dates the happening no longer has.
 * `/tasks` is revalidated whenever one was touched.
 */

const AVAILABILITY_ERROR = "That isn't one of the availability options.";

function availabilityFromForm(form: FormData): AvailabilityImpact | null {
  const raw = str(form, "availability") ?? "NONE";
  return (AVAILABILITY_IMPACTS as readonly string[]).includes(raw)
    ? (raw as AvailabilityImpact)
    : null;
}

export async function createHappening(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const title = str(form, "title");
  const when = partialDate(form, "date");
  if (!contactId || !title || !when) return fail("A title and a date are required.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const end = partialDate(form, "endDate");
  if (
    !isValidPartialDateRange(
      { date: plainDateFromDb(when.date), precision: when.precision },
      end ? { date: plainDateFromDb(end.date), precision: end.precision } : null,
    )
  ) {
    return fieldError("endDate", "End date must not be before the start date.");
  }

  const availability = availabilityFromForm(form);
  if (!availability) return fail(AVAILABILITY_ERROR);

  const type = await termFromForm(ownerId, form, "typeId", "HAPPENING_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  const wantsFollowUp = bool(form, "followUp");

  const created = await prisma.$transaction(async (tx) => {
    const happening = await tx.happening.create({
      data: {
        ownerId,
        contactId,
        typeId: type.id,
        title,
        notes: str(form, "notes") ?? null,
        source: str(form, "source") ?? null,
        date: when.date,
        precision: when.precision,
        endDate: end?.date ?? null,
        endPrecision: end?.precision ?? null,
        availability,
        isTentative: bool(form, "isTentative"),
      },
    });

    const followUpTaskId = await syncFollowUpTask(
      tx,
      { ...happeningDatesOf(happening), id: happening.id, ownerId, contactId, title, followUpTaskId: null },
      wantsFollowUp,
    );
    if (followUpTaskId) {
      await tx.happening.update({ where: { id: happening.id }, data: { followUpTaskId } });
    }
    return happening;
  });

  touch(contactId);
  if (wantsFollowUp) revalidatePath("/tasks");
  return ok({ id: created.id });
}

export async function updateHappening(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing happening.");

  const scope = await privacyScope();
  const existing = await prisma.happening.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(scope) },
    select: {
      contactId: true,
      followUpTaskId: true,
      date: true,
      precision: true,
      endDate: true,
      endPrecision: true,
    },
  });
  if (!existing) return fail("Not found.");

  const title = str(form, "title");
  const when = partialDate(form, "date");
  if (!title || !when) return fail("A title and a date are required.");

  const end = partialDate(form, "endDate");
  if (
    !isValidPartialDateRange(
      { date: plainDateFromDb(when.date), precision: when.precision },
      end ? { date: plainDateFromDb(end.date), precision: end.precision } : null,
    )
  ) {
    return fieldError("endDate", "End date must not be before the start date.");
  }

  const availability = availabilityFromForm(form);
  if (!availability) return fail(AVAILABILITY_ERROR);

  const type = await termFromForm(ownerId, form, "typeId", "HAPPENING_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  const wantsFollowUp = bool(form, "followUp");

  // Re-dating makes it something to ask about again. Without this, moving a
  // trip you had already dismissed to a later date left it dismissed for good:
  // the follow-up prompt would never come back, because the digest only offers
  // happenings that have not been acknowledged.
  const reDated =
    existing.date.getTime() !== when.date.getTime() ||
    existing.precision !== when.precision ||
    (existing.endDate?.getTime() ?? null) !== (end?.date.getTime() ?? null) ||
    existing.endPrecision !== (end?.precision ?? null);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.happening.update({
      where: { id },
      data: {
        typeId: type.id,
        title,
        notes: str(form, "notes") ?? null,
        source: str(form, "source") ?? null,
        date: when.date,
        precision: when.precision,
        endDate: end?.date ?? null,
        endPrecision: end?.precision ?? null,
        availability,
        isTentative: bool(form, "isTentative"),
        ...(reDated ? { acknowledgedAt: null } : {}),
      },
    });

    const followUpTaskId = await syncFollowUpTask(
      tx,
      {
        ...happeningDatesOf(updated),
        id,
        ownerId,
        contactId: existing.contactId,
        title,
        followUpTaskId: existing.followUpTaskId,
      },
      wantsFollowUp,
    );
    if (followUpTaskId !== existing.followUpTaskId) {
      await tx.happening.update({ where: { id }, data: { followUpTaskId } });
    }
  });

  touch(existing.contactId);
  if (wantsFollowUp || existing.followUpTaskId) revalidatePath("/tasks");
  return ok();
}

/**
 * Dismiss a finished happening from the "just wrapped up" list.
 *
 * A timestamp rather than a delete: you asked how the trip went, which is worth
 * keeping. Nothing else about the row changes.
 */
export async function acknowledgeHappening(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.happening.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(scope) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.happening.update({ where: { id }, data: { acknowledgedAt: new Date() } });
  touch(existing.contactId);
  return ok();
}

export async function deleteHappening(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.happening.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(scope) },
    select: { contactId: true, followUpTaskId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.$transaction(async (tx) => {
    await tx.happening.delete({ where: { id } });
    await deleteFollowUpTask(tx, ownerId, existing.followUpTaskId);
  });

  touch(existing.contactId);
  if (existing.followUpTaskId) revalidatePath("/tasks");
  return ok();
}

// --- ideas -----------------------------------------------------------------

export async function createIdea(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const content = str(form, "content");
  if (!content) return fail("What did you want to bring up?");
  const contactId = str(form, "contactId") ?? null;
  if (contactId && !(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const created = await prisma.idea.create({ data: { ownerId, contactId, content } });
  touch(contactId);
  revalidatePath("/ideas");
  return ok({ id: created.id });
}

export async function updateIdea(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const content = str(form, "content");
  if (!id || !content) return fail("What did you want to bring up?");

  const existing = await prisma.idea.findFirst({
    where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.idea.update({ where: { id }, data: { content } });

  touch(existing.contactId);
  revalidatePath("/ideas");
  return ok();
}

export async function setIdeaStatus(
  id: string,
  status: "OPEN" | "USED" | "ARCHIVED",
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.idea.findFirst({ where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");

  await prisma.idea.update({
    where: { id },
    data: { status, usedAt: status === "USED" ? new Date() : null },
  });

  touch(existing.contactId);
  revalidatePath("/ideas");
  return ok();
}

export async function deleteIdea(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.idea.findFirst({ where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");
  await prisma.idea.delete({ where: { id } });
  touch(existing.contactId);
  revalidatePath("/ideas");
  return ok();
}

// --- plans -----------------------------------------------------------------

/**
 * Things to do: a place to go, a film to see, a hike, a thing to try.
 *
 * Sits beside ideas rather than inside them, and beside the dating layer
 * rather than inside that. An idea is something to *say* and ends when you say
 * it; a plan is something to *do* and ends when you do it. Which is why a hike
 * with a friend and a first date are the same row here — only the person
 * differs, and `contactId` may be null when nobody in particular does.
 *
 * Not behind the privacy lock. Locking these would put your own hiking list
 * behind a PIN; plans follow the same rule as gifts instead, inheriting the
 * privacy of the person they name.
 */

const PLAN_STATUSES = ["OPEN", "PLANNED", "DONE", "ARCHIVED"] as const;
export type PlanStatusValue = (typeof PLAN_STATUSES)[number];

function planStatusOf(value?: string): PlanStatusValue {
  return (PLAN_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as PlanStatusValue)
    : "OPEN";
}

function touchPlans(contactId?: string | null) {
  revalidatePath("/");
  revalidatePath("/ideas");
  revalidatePath("/dating");
  // A plan resolves a venue, so saving one can create a place. Without this the
  // Places directory kept serving a cached list that the new place was missing.
  revalidatePath("/locations");
  if (contactId) revalidatePath(`/people/${contactId}`);
}

/**
 * The fields create and update share.
 *
 * Null on an unknown category rather than a silent drop: a category the user
 * cannot see is either someone else's row or a stale form, and both deserve an
 * error instead of a plan filed under nothing.
 */
async function planFields(ownerId: string, form: FormData) {
  const categoryId = str(form, "categoryId") ?? null;
  if (categoryId) {
    const term = await prisma.taxonomyTerm.findFirst({
      where: { id: categoryId, ownerId, kind: "PLAN_CATEGORY" },
      select: { id: true },
    });
    if (!term) return null;
  }

  let checklistValue: unknown;
  try {
    checklistValue = JSON.parse(str(form, "checklist") ?? "[]");
  } catch {
    return null;
  }
  const checklist = planChecklistSchema.safeParse(checklistValue);
  if (!checklist.success) return null;

  const startMinute = parsePlanMinute(str(form, "plannedStartTime"));
  if (!startMinute.ok) return null;
  if (startMinute.value !== null && startMinute.value > PLAN_MINUTE_MAX) return null;

  const duration = parsePlanDuration(str(form, "plannedDurationMinutes"));
  if (!duration.ok) return null;

  const cost = num(form, "estimatedCost");

  // An unreadable day is not an empty one. `plainDate` answers `undefined` to
  // both, and folding them together let a malformed "2026-02-30" save as a
  // plan with no date at all — quietly taking the time and duration with it,
  // and reporting success.
  const plannedForRaw = str(form, "plannedFor");
  const plannedFor = plannedForRaw ? plainDate(form, "plannedFor") : null;
  if (plannedForRaw && !plannedFor) return null;

  return {
    categoryId,
    location: str(form, "location") ?? null,
    address: str(form, "address") ?? null,
    url: str(form, "url") ?? null,
    estimatedCostCents: cost === undefined ? null : Math.round(cost * 100),
    notes: str(form, "notes") ?? null,
    checklist: checklist.data as Prisma.InputJsonValue,
    plannedFor,
    // A time on nothing is not a time. Dropping it rather than refusing the
    // save keeps clearing the day from becoming an error the user has to go
    // and understand, and leaves nothing behind to surface later as an hour
    // against a plan with no date.
    plannedStartMinute: plannedFor ? startMinute.value : null,
    // How long a thing takes is a property of the thing, not of the day you
    // picked for it: "the observatory takes most of an evening" is worth
    // keeping on a plan nobody has scheduled yet. Only the start time needs a
    // day to hang on.
    plannedDurationMinutes: duration.value,
  };
}

export async function createPlan(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const title = str(form, "title");
  if (!title) return fail("What do you want to do?");

  const contactId = str(form, "contactId") ?? null;
  if (contactId && !(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const fields = await planFields(ownerId, form);
  if (!fields) return fail("Check the category, checklist and time.");

  const created = await prisma.$transaction(async (tx) => {
    const place = await resolveLocation(tx, ownerId, fields.location ?? undefined, {
      address: fields.address,
      url: fields.url,
    });
    return tx.plan.create({
      data: { ownerId, contactId, title, status: planStatusOf(str(form, "status")), ...fields, locationId: place?.id ?? null },
    });
  });

  touchPlans(contactId);
  return ok({ id: created.id });
}

export async function updatePlan(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing plan.");

  const existing = await prisma.plan.findFirst({
    where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const title = str(form, "title");
  if (!title) return fail("What do you want to do?");

  const fields = await planFields(ownerId, form);
  if (!fields) return fail("Check the category, checklist and time.");

  await prisma.$transaction(async (tx) => {
    const place = await resolveLocation(tx, ownerId, fields.location ?? undefined, {
      address: fields.address,
      url: fields.url,
    });
    await tx.plan.update({ where: { id }, data: { title, ...fields, locationId: place?.id ?? null } });
  });

  touchPlans(existing.contactId);
  return ok();
}

/**
 * Move a plan along. `usedAt` is stamped on the way to DONE and cleared on the
 * way back, so one marked done by mistake returns to the list clean.
 */
export async function setPlanStatus(id: string, status: PlanStatusValue): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.plan.findFirst({
    where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const next = planStatusOf(status);
  await prisma.plan.update({
    where: { id },
    data: {
      status: next,
      usedAt: next === "DONE" ? new Date() : null,
      ...(next === "DONE" ? {} : { usedInInteractionId: null }),
    },
  });

  touchPlans(existing.contactId);
  return ok();
}

export async function deletePlan(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.plan.findFirst({
    where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.plan.delete({ where: { id } });

  touchPlans(existing.contactId);
  return ok();
}

// --- tasks -----------------------------------------------------------------

export async function createTask(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const title = str(form, "title");
  if (!title) return fail("Give the task a name.");
  const contactId = str(form, "contactId") ?? null;
  if (contactId && !(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const created = await prisma.task.create({
    data: {
      ownerId,
      contactId,
      title,
      notes: str(form, "notes") ?? null,
      dueDate: plainDate(form, "dueDate") ?? null,
      priority: priorityOf(str(form, "priority")),
    },
  });

  touch(contactId);
  revalidatePath("/tasks");
  return ok({ id: created.id });
}

/**
 * Correct a task.
 *
 * The due date is read straight back out of the form, so clearing it in the
 * picker clears it on the row — an edit that could only ever move a date
 * forward would leave "chase this by Friday" hanging over a thing that turned
 * out not to have a deadline at all.
 */
export async function updateTask(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const title = str(form, "title");
  if (!id || !title) return fail("Give the task a name.");

  const existing = await prisma.task.findFirst({
    where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.task.update({
    where: { id },
    data: {
      title,
      notes: str(form, "notes") ?? null,
      dueDate: plainDate(form, "dueDate") ?? null,
      priority: priorityOf(str(form, "priority")),
    },
  });

  touch(existing.contactId);
  revalidatePath("/tasks");
  return ok();
}

export async function setTaskDone(id: string, done: boolean): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.task.findFirst({ where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");

  await prisma.task.update({ where: { id }, data: { completedAt: done ? new Date() : null } });
  touch(existing.contactId);
  revalidatePath("/tasks");
  return ok();
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.task.findFirst({ where: { id, ownerId, ...viaOptionalContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");
  await prisma.task.delete({ where: { id } });
  touch(existing.contactId);
  revalidatePath("/tasks");
  return ok();
}

// --- gifts -----------------------------------------------------------------

export async function createGift(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const name = str(form, "name");
  if (!contactId || !name) return fail("What's the gift?");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const price = num(form, "price");
  const occasion = await termFromForm(ownerId, form, "occasionId", "GIFT_OCCASION");
  if (!occasion.ok) return fail(UNKNOWN_TERM);

  const created = await prisma.gift.create({
    data: {
      ownerId,
      contactId,
      name,
      description: str(form, "description") ?? null,
      url: str(form, "url") ?? null,
      priceCents: price === undefined ? null : Math.round(price * 100),
      occasionId: occasion.id,
      status: giftStatusOf(str(form, "status")),
      direction: str(form, "direction") === "INCOMING" ? "INCOMING" : "OUTGOING",
      occurredOn: plainDate(form, "occurredOn") ?? null,
    },
  });

  touch(contactId);
  revalidatePath("/gifts");
  return ok({ id: created.id });
}

/**
 * Correct a gift.
 *
 * `status` is carried in the form rather than left to `setGiftStatus`, because
 * an edit that reset every gift to IDEA on save would quietly un-give things
 * you have already handed over.
 */
export async function updateGift(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const name = str(form, "name");
  if (!id || !name) return fail("What's the gift?");

  const existing = await prisma.gift.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true, status: true },
  });
  if (!existing) return fail("Not found.");

  const price = num(form, "price");
  const occasion = await termFromForm(ownerId, form, "occasionId", "GIFT_OCCASION");
  if (!occasion.ok) return fail(UNKNOWN_TERM);

  await prisma.gift.update({
    where: { id },
    data: {
      name,
      description: str(form, "description") ?? null,
      url: str(form, "url") ?? null,
      priceCents: price === undefined ? null : Math.round(price * 100),
      occasionId: occasion.id,
      status: giftStatusOf(str(form, "status") ?? existing.status),
      direction: str(form, "direction") === "INCOMING" ? "INCOMING" : "OUTGOING",
      occurredOn: plainDate(form, "occurredOn") ?? null,
    },
  });

  touch(existing.contactId);
  revalidatePath("/gifts");
  return ok();
}

export async function setGiftStatus(
  id: string,
  status: "IDEA" | "RESERVED" | "PURCHASED" | "GIVEN",
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.gift.findFirst({ where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");
  await prisma.gift.update({ where: { id }, data: { status } });
  touch(existing.contactId);
  revalidatePath("/gifts");
  return ok();
}

export async function deleteGift(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.gift.findFirst({ where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) }, select: { contactId: true } });
  if (!existing) return fail("Not found.");
  await prisma.gift.delete({ where: { id } });
  touch(existing.contactId);
  revalidatePath("/gifts");
  return ok();
}

// --- debts -----------------------------------------------------------------

export async function createDebt(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId, timezone } = await owner();
  const contactId = str(form, "contactId");
  const description = str(form, "description");
  if (!contactId || !description) return fail("What was lent?");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const amount = num(form, "amount");
  // Most debts are written down as they happen, so an empty date means today
  // rather than an error — in the account's timezone, not the server's.
  const incurredOn =
    plainDate(form, "incurredOn") ?? plainDateToDb(calendarDateInTz(new Date(), timezone));

  const created = await prisma.debt.create({
    data: {
      ownerId,
      contactId,
      direction: debtDirectionOf(str(form, "direction")),
      description,
      // Null keeps a lent object out of the balance rather than valuing it at
      // zero, which would read as a settled debt.
      amountCents: amount === undefined ? null : Math.round(amount * 100),
      currency: str(form, "currency")?.toUpperCase() ?? "USD",
      incurredOn,
      notes: str(form, "notes") ?? null,
      isPrivate: bool(form, "isPrivate"),
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

/**
 * Correct a debt.
 *
 * `settledOn` is not touched here — settling is its own act, with its own
 * check that the date is not before the debt started, and folding it into a
 * general edit would let a typo in the description quietly re-open something
 * already squared away.
 */
export async function updateDebt(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const description = str(form, "description");
  if (!id || !description) return fail("What was lent?");

  // As with facts: while the lock is closed a private debt is out of reach,
  // not merely hidden.
  const scope = await privacyScope();
  const existing = await prisma.debt.findFirst({
    where: {
      id,
      ownerId,
      ...debtPrivacyWhere(scope),
      ...viaContactPrivacyWhere(scope),
    },
    select: { contactId: true, incurredOn: true, settledOn: true, isPrivate: true },
  });
  if (!existing) return fail("Not found.");

  const marker = await privacyMarker(form, existing.isPrivate);
  if (!marker.ok) return fail(marker.error);

  const incurredOn = plainDate(form, "incurredOn") ?? existing.incurredOn;
  // Same nonsense as settling early, arrived at from the other side: moving
  // the start of a settled debt past the day it was squared up.
  if (existing.settledOn && incurredOn > existing.settledOn) {
    return fail("That's after the debt was settled.");
  }

  const amount = num(form, "amount");

  await prisma.debt.update({
    where: { id },
    data: {
      direction: debtDirectionOf(str(form, "direction")),
      description,
      amountCents: amount === undefined ? null : Math.round(amount * 100),
      currency: str(form, "currency")?.toUpperCase() ?? "USD",
      incurredOn,
      notes: str(form, "notes") ?? null,
      isPrivate: marker.isPrivate,
    },
  });

  touch(existing.contactId);
  return ok();
}

export async function settleDebt(id: string, on: Date | null): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.debt.findFirst({
    where: {
      id,
      ownerId,
      ...debtPrivacyWhere(scope),
      ...viaContactPrivacyWhere(scope),
    },
    select: { contactId: true, incurredOn: true },
  });
  if (!existing) return fail("Not found.");
  // A debt settled before it was incurred makes nonsense of any later report,
  // and it is far more likely to be a typo than a story worth keeping.
  if (on && on < existing.incurredOn) return fail("That's before the debt started.");

  await prisma.debt.update({ where: { id }, data: { settledOn: on } });
  touch(existing.contactId);
  return ok();
}

export async function deleteDebt(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const existing = await prisma.debt.findFirst({
    where: {
      id,
      ownerId,
      ...debtPrivacyWhere(scope),
      ...viaContactPrivacyWhere(scope),
    },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.debt.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

// --- dietary needs ---------------------------------------------------------

export async function createDietaryNeed(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const label = str(form, "label");
  if (!contactId || !label) return fail("What can't they have?");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const duplicate = await prisma.dietaryNeed.findFirst({
    where: { ownerId, contactId, label },
    select: { id: true },
  });
  if (duplicate) return fail("That allergy or dietary need is already recorded.");

  const kind = dietaryKindOf(str(form, "kind"));
  const category = allergyCategoryOf(str(form, "category"));
  if (!validAllergyCombination(kind, category)) return fail("That category is only for allergies.");
  const isAllergy = kind === "ALLERGY";
  const diagnosed = str(form, "professionallyDiagnosed");

  const created = await prisma.dietaryNeed.create({
    data: {
      ownerId,
      contactId,
      kind,
      category,
      label,
      notes: str(form, "notes") ?? null,
      reaction: isAllergy ? str(form, "reaction") ?? null : null,
      carriesEpinephrine: isAllergy && bool(form, "carriesEpinephrine"),
      epinephrineLocation: isAllergy ? str(form, "epinephrineLocation") ?? null : null,
      emergencyInstructions: isAllergy ? str(form, "emergencyInstructions") ?? null : null,
      professionallyDiagnosed: isAllergy
        ? diagnosed === "yes" ? true : diagnosed === "no" ? false : null
        : null,
      lastConfirmedOn: isAllergy ? plainDate(form, "lastConfirmedOn") : null,
    },
  });

  if (isAllergy) {
    await prisma.contact.update({ where: { id: contactId }, data: { allergyStatus: "KNOWN" } });
  }

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateDietaryNeed(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const label = str(form, "label");
  if (!id || !label) return fail("What can't they have?");

  const existing = await prisma.dietaryNeed.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true, kind: true },
  });
  if (!existing) return fail("Not found.");

  const kind = dietaryKindOf(str(form, "kind"));
  const category = allergyCategoryOf(str(form, "category"));
  if (!validAllergyCombination(kind, category)) return fail("That category is only for allergies.");
  const isAllergy = kind === "ALLERGY";
  const diagnosed = str(form, "professionallyDiagnosed");

  await prisma.dietaryNeed.update({
    where: { id },
    data: {
      kind,
      category,
      label,
      notes: str(form, "notes") ?? null,
      reaction: isAllergy ? str(form, "reaction") ?? null : null,
      carriesEpinephrine: isAllergy && bool(form, "carriesEpinephrine"),
      epinephrineLocation: isAllergy ? str(form, "epinephrineLocation") ?? null : null,
      emergencyInstructions: isAllergy ? str(form, "emergencyInstructions") ?? null : null,
      professionallyDiagnosed: isAllergy
        ? diagnosed === "yes" ? true : diagnosed === "no" ? false : null
        : null,
      lastConfirmedOn: isAllergy ? plainDate(form, "lastConfirmedOn") : null,
    },
  });

  if (isAllergy) {
    await prisma.contact.update({ where: { id: existing.contactId }, data: { allergyStatus: "KNOWN" } });
  } else if (existing.kind === "ALLERGY") {
    const remaining = await prisma.dietaryNeed.count({
      where: { ownerId, contactId: existing.contactId, kind: "ALLERGY" },
    });
    if (remaining === 0) {
      await prisma.contact.update({ where: { id: existing.contactId }, data: { allergyStatus: "UNKNOWN" } });
    }
  }

  touch(existing.contactId);
  return ok();
}

export async function deleteDietaryNeed(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.dietaryNeed.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true, kind: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.dietaryNeed.delete({ where: { id } });
  if (existing.kind === "ALLERGY") {
    const remaining = await prisma.dietaryNeed.count({ where: { ownerId, contactId: existing.contactId, kind: "ALLERGY" } });
    if (remaining === 0) {
      await prisma.contact.update({ where: { id: existing.contactId }, data: { allergyStatus: "UNKNOWN" } });
    }
  }
  touch(existing.contactId);
  return ok();
}

export async function updateAllergyStatus(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId || !(await ownsContact(ownerId, contactId))) return fail("Contact not found.");
  const allergyStatus = allergyStatusOf(str(form, "allergyStatus"));
  if (allergyStatus === "NO_KNOWN") {
    const allergies = await prisma.dietaryNeed.count({
      where: { ownerId, contactId, kind: "ALLERGY" },
    });
    if (allergies > 0) return fail("Remove recorded allergies before choosing no known allergies.");
  }
  await prisma.contact.update({ where: { id: contactId }, data: { allergyStatus } });
  touch(contactId);
  return ok();
}

// --- relationships ---------------------------------------------------------

/**
 * Link two people, writing both directions.
 *
 * Relationship terms carry an `inverseTermId`, so recording "Alice is Bob's
 * parent" also records "Bob is Alice's child". The two rows share a `pairId`
 * so removing one removes both.
 */
export async function createRelationship(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const fromContactId = str(form, "fromContactId");
  const toContactId = str(form, "toContactId");
  const typeId = str(form, "typeId");
  if (!fromContactId || !toContactId || !typeId) return fail("Pick a person and a relationship.");
  if (fromContactId === toContactId) return fail("Someone can't be related to themselves.");

  const [from, to, type] = await Promise.all([
    prisma.contact.findFirst({ where: { id: fromContactId, ownerId, ...contactPrivacyWhere(scope) }, select: { id: true } }),
    prisma.contact.findFirst({ where: { id: toContactId, ownerId, ...contactPrivacyWhere(scope) }, select: { id: true } }),
    prisma.taxonomyTerm.findFirst({
      where: { id: typeId, ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, inverseTermId: true },
    }),
  ]);
  if (!from || !to) return fail("Contact not found.");
  if (!type) return fail("Unknown relationship type.");

  const pairId = randomBytes(8).toString("hex");
  const inverseTypeId = type.inverseTermId ?? type.id;
  const notes = str(form, "notes") ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: { fromContactId, toContactId, typeId: type.id },
      },
      create: { ownerId, fromContactId, toContactId, typeId: type.id, pairId, notes },
      update: { pairId, notes },
    });
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: {
          fromContactId: toContactId,
          toContactId: fromContactId,
          typeId: inverseTypeId,
        },
      },
      create: {
        ownerId,
        fromContactId: toContactId,
        toContactId: fromContactId,
        typeId: inverseTypeId,
        pairId,
        notes,
      },
      update: { pairId, notes },
    });
  });

  touch(fromContactId);
  touch(toContactId);
  return ok();
}

/**
 * Fix the word for a link that is already there.
 *
 * Both halves move together, so correcting "Bob is Alice's colleague" to
 * "neighbour" does not leave Alice still filed as Bob's colleague. The `pairId`
 * and whatever notes each half carries survive: the people and the connection
 * were never wrong, only the label on it.
 */
export async function updateRelationship(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const typeId = str(form, "typeId");
  if (!id || !typeId) return fail("Pick a relationship.");

  const existing = await prisma.relationship.findFirst({
    where: {
      id,
      ownerId,
      fromContact: contactPrivacyWhere(await privacyScope()),
      toContact: contactPrivacyWhere(await privacyScope()),
    },
    select: { pairId: true, fromContactId: true, toContactId: true, notes: true },
  });
  if (!existing) return fail("Not found.");

  const type = await prisma.taxonomyTerm.findFirst({
    where: { id: typeId, ownerId, kind: "RELATIONSHIP_TYPE" },
    select: { id: true, inverseTermId: true },
  });
  if (!type) return fail("Unknown relationship type.");

  const { pairId, fromContactId, toContactId } = existing;
  const inverseTypeId = type.inverseTermId ?? type.id;
  const notes = str(form, "notes") ?? existing.notes;

  const inverse = await prisma.relationship.findFirst({
    where: { ownerId, pairId, fromContactId: toContactId, toContactId: fromContactId },
    select: { notes: true },
  });

  await prisma.$transaction(async (tx) => {
    // Cleared first so the re-typed rows cannot collide with the rows they
    // replace; the pair is then written back exactly as `createRelationship`
    // writes a new one, which also collapses into a row that already carries
    // the target type rather than tripping the uniqueness constraint.
    await tx.relationship.deleteMany({ where: { ownerId, pairId } });

    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: { fromContactId, toContactId, typeId: type.id },
      },
      create: { ownerId, fromContactId, toContactId, typeId: type.id, pairId, notes },
      update: { pairId, notes },
    });
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: {
          fromContactId: toContactId,
          toContactId: fromContactId,
          typeId: inverseTypeId,
        },
      },
      create: {
        ownerId,
        fromContactId: toContactId,
        toContactId: fromContactId,
        typeId: inverseTypeId,
        pairId,
        notes: inverse?.notes ?? null,
      },
      update: { pairId, notes: inverse?.notes ?? null },
    });
  });

  touch(fromContactId);
  touch(toContactId);
  return ok();
}

export async function deleteRelationship(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.relationship.findFirst({
    where: {
      id,
      ownerId,
      fromContact: contactPrivacyWhere(await privacyScope()),
      toContact: contactPrivacyWhere(await privacyScope()),
    },
    select: { pairId: true, fromContactId: true, toContactId: true },
  });
  if (!existing) return fail("Not found.");

  // Remove both halves of the pair, so the reciprocal doesn't linger.
  await prisma.relationship.deleteMany({ where: { ownerId, pairId: existing.pairId } });

  touch(existing.fromContactId);
  touch(existing.toContactId);
  return ok();
}

// --- contact methods -------------------------------------------------------

/**
 * Bounded to the column widths, so an over-long paste comes back as a field
 * error rather than a database rejection thrown out of the action. The forms
 * mirror these with `maxLength`, which stops it happening in the first place
 * without being the thing relied on — a server action is a public POST.
 */
const methodSchema = z.object({
  value: z.string().trim().min(1, "A value is required.").max(255),
  label: z.string().trim().max(96).optional(),
});

const addressSchema = z.object({
  label: z.string().trim().max(96).optional(),
  line1: z.string().trim().max(191).optional(),
  line2: z.string().trim().max(191).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(32).optional(),
  country: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  osmType: z.enum(["N", "W", "R"]).optional(),
  osmId: z.string().trim().regex(/^\d+$/).max(20).optional(),
});

/**
 * Phone numbers, email addresses and handles.
 *
 * `ContactMethod` and `Address` carry no `ownerId` and no `isPrivate` — they
 * exist only beneath a contact, and a phone number is not separately hideable
 * from the person it belongs to. Both facts shape every query below: ownership
 * and the privacy lock are checked on the *contact*, so an id remembered from
 * an unlocked session is not a way back into a private person's number.
 */
async function methodParent(
  ownerId: string,
  id: string,
): Promise<{ contactId: string } | null> {
  return prisma.contactMethod.findFirst({
    where: { id, contact: { ownerId, ...contactPrivacyWhere(await privacyScope()) } },
    select: { contactId: true },
  });
}

export async function createContactMethod(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId) return fail("Contact not found.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  // Stored exactly as typed, only trimmed. Reformatting "07700 900461" into
  // "+44 7700 900461" would guess a country nobody gave — the same lie about
  // certainty that DatePrecision exists to prevent.
  const parsed = methodSchema.safeParse({
    value: str(form, "value"),
    label: str(form, "label"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const type = await termFromForm(ownerId, form, "typeId", "CONTACT_METHOD_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  // The contact row is locked first, which is what actually serialises this.
  // A plain read inside a transaction is still a non-locking consistent read
  // under MariaDB's default isolation, so two requests adding the first method
  // for one contact would both see an empty list, both claim primary, and both
  // write sortOrder 0 — and there is no partial unique index to catch it after
  // the fact. Locking the parent is cheaper than serialising the whole
  // transaction and scopes the contention to the one contact.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Contact WHERE id = ${contactId} FOR UPDATE`;

    const existing = await tx.contactMethod.findMany({
      where: { contactId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    return tx.contactMethod.create({
      data: {
        contactId,
        typeId: type.id,
        value: parsed.data.value,
        label: parsed.data.label ?? null,
        // The only method there is, is the one to try first. Leaving it
        // unmarked means the header shows nothing until a button nobody knows
        // about is pressed, which reads as the number not having saved.
        isPrimary: existing.length === 0,
        sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
      },
    });
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateContactMethod(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing method.");
  const existing = await methodParent(ownerId, id);
  if (!existing) return fail("Not found.");

  const parsed = methodSchema.safeParse({
    value: str(form, "value"),
    label: str(form, "label"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const type = await termFromForm(ownerId, form, "typeId", "CONTACT_METHOD_TYPE");
  if (!type.ok) return fail(UNKNOWN_TERM);

  await prisma.contactMethod.update({
    where: { id },
    data: { typeId: type.id, value: parsed.data.value, label: parsed.data.label ?? null },
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteContactMethod(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await methodParent(ownerId, id);
  if (!existing) return fail("Not found.");
  await prisma.contactMethod.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

/**
 * Promote one method to primary, demoting whatever held it.
 *
 * Its own action rather than a checkbox on the form: as a field it is written
 * on every save, so ticking it twice leaves two rows claiming to be primary and
 * the detail page silently picks whichever sorts first. MariaDB has no partial
 * unique index to lean on, so "exactly one" is only ever as true as the
 * transaction that clears the others in the same breath.
 */
export async function setPrimaryContactMethod(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await methodParent(ownerId, id);
  if (!existing) return fail("Not found.");

  await prisma.$transaction(async (tx) => {
    await tx.contactMethod.updateMany({
      where: { contactId: existing.contactId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.contactMethod.update({ where: { id }, data: { isPrimary: true } });

    // Promotion moves the row to the front, rather than only flagging it.
    // The list renders primary-first and the arrows step through `sortOrder`,
    // so leaving the two to disagree makes a promoted last method render at
    // the top with a down arrow that finds no greater `sortOrder` and appears
    // to do nothing. One order, and the arrows mean what they show.
    const rest = await tx.contactMethod.findMany({
      where: { contactId: existing.contactId, id: { not: id } },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    await tx.contactMethod.update({ where: { id }, data: { sortOrder: 0 } });
    for (const [index, row] of rest.entries()) {
      await tx.contactMethod.update({ where: { id: row.id }, data: { sortOrder: index + 1 } });
    }
  });

  touch(existing.contactId);
  return ok();
}

export async function moveContactMethod(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const current = await prisma.contactMethod.findFirst({
    where: { id, contact: { ownerId, ...contactPrivacyWhere(await privacyScope()) } },
    select: { id: true, contactId: true, sortOrder: true, isPrimary: true },
  });
  if (!current) return fail("Not found.");

  // The list renders primary-first, so the primary row cannot move: swapping
  // its sortOrder leaves it exactly where it was on screen, which reads as the
  // arrow doing nothing. It is pinned by being primary; promoting another
  // method is how it stops being first.
  if (current.isPrimary) return ok();

  const neighbour = await prisma.contactMethod.findFirst({
    where: {
      contactId: current.contactId,
      isPrimary: false,
      sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });
  // Already at the end — not an error, just nothing to do.
  if (!neighbour) return ok();

  await prisma.$transaction([
    prisma.contactMethod.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
    prisma.contactMethod.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  touch(current.contactId);
  return ok();
}

// --- addresses -------------------------------------------------------------

const ADDRESS_PARTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;

/**
 * An address with nothing in it renders as a row that is only a delete button,
 * so at least one line has to say where.
 */
/**
 * Plain values only, never Prisma's `{ set: … }` update operations, so the same
 * object serves both `create` and `update`.
 */
type AddressData = Omit<Prisma.AddressUncheckedCreateInput, "id" | "contactId">;

type AddressFields =
  | { ok: true; data: AddressData }
  | { ok: false; result: ActionResult<never> };

function addressFields(form: FormData): AddressFields {
  const parsed = addressSchema.safeParse({
    label: str(form, "label"),
    line1: str(form, "line1"),
    line2: str(form, "line2"),
    city: str(form, "city"),
    region: str(form, "region"),
    postalCode: str(form, "postalCode"),
    country: str(form, "country"),
    notes: str(form, "notes"),
    latitude: str(form, "latitude"),
    longitude: str(form, "longitude"),
    osmType: str(form, "osmType"),
    osmId: str(form, "osmId"),
  });
  if (!parsed.success) return { ok: false, result: invalid(parsed.error) };

  if (!ADDRESS_PARTS.some((part) => parsed.data[part])) {
    return { ok: false, result: fieldError("line1", "Fill in at least one line of the address.") };
  }

  // A latitude on its own is not a place — it is a point on the prime meridian.
  // Said out loud rather than silently dropped, because the person typing it
  // meant to place the address and would otherwise never learn they had not.
  const { latitude, longitude } = parsed.data;
  if ((latitude === undefined) !== (longitude === undefined)) {
    return {
      ok: false,
      result: fieldError(
        latitude === undefined ? "latitude" : "longitude",
        "Give both a latitude and a longitude, or neither.",
      ),
    };
  }

  const data: AddressData = {};
  for (const key of [...ADDRESS_PARTS, "label", "notes"] as const) {
    data[key] = parsed.data[key] ?? null;
  }

  data.latitude = latitude ?? null;
  data.longitude = longitude ?? null;
  // The OSM reference only means anything beside the coordinates it came with.
  // Kept without them it would outlive the place it described, and `mapLinkFor`
  // prefers it — so the map would open the venue the address used to be.
  const placed = latitude !== undefined;
  data.osmType = placed ? parsed.data.osmType ?? null : null;
  data.osmId =
    placed && parsed.data.osmType && parsed.data.osmId
      ? BigInt(parsed.data.osmId)
      : null;

  return { ok: true, data };
}

async function addressParent(
  ownerId: string,
  id: string,
): Promise<{ contactId: string } | null> {
  return prisma.address.findFirst({
    where: { id, contact: { ownerId, ...contactPrivacyWhere(await privacyScope()) } },
    select: { contactId: true },
  });
}

export async function createAddress(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  if (!contactId) return fail("Contact not found.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const fields = addressFields(form);
  if (!fields.ok) return fields.result;

  const created = await prisma.address.create({ data: { contactId, ...fields.data } });
  touch(contactId);
  return ok({ id: created.id });
}

export async function updateAddress(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing address.");
  const existing = await addressParent(ownerId, id);
  if (!existing) return fail("Not found.");

  const fields = addressFields(form);
  if (!fields.ok) return fields.result;

  await prisma.address.update({ where: { id }, data: fields.data });
  touch(existing.contactId);
  return ok();
}

export async function deleteAddress(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await addressParent(ownerId, id);
  if (!existing) return fail("Not found.");
  await prisma.address.delete({ where: { id } });
  touch(existing.contactId);
  return ok();
}

/**
 * Ask the configured endpoint where an address is. Writes nothing.
 *
 * Refused outright for a private contact. The rule the AI layer already
 * follows — a line naming a private contact never leaves the machine whatever
 * the toggle says — applies here for the same reason: a home address is a
 * stronger identifier than a name, and "off by default" is not the same promise
 * as "never". Their coordinates are typed in by hand instead, which is why the
 * form offers the fields directly.
 *
 * For everyone else only the address itself is sent — the lines, the city, the
 * region, the country. Never the label, never the notes, and never the name of
 * the person who lives there.
 */
export async function lookupContactAddress(
  form: FormData,
): Promise<ActionResult<{ candidates: GeoCandidateView[] }>> {
  const { ownerId } = await owner();

  const contactId = str(form, "contactId");
  if (!contactId) return fail("Contact not found.");

  // Owner-scoped and lock-checked in one query, exactly as every other write
  // here is: an id remembered from an unlocked session is not a way back in.
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId, ...contactPrivacyWhere(await privacyScope()) },
    select: { isPrivate: true },
  });
  if (!contact) return fail("Contact not found.");
  if (contact.isPrivate) {
    return fail(
      "This person is private, so their address is never sent anywhere. Fill in the coordinates by hand to place it.",
    );
  }

  const query = str(form, "query");
  if (!query) return fail("Fill in the address first, then look it up.");

  const { searchPlaces, LOOKUP_MESSAGES } = await import("@/server/geo/lookup");
  const outcome = await searchPlaces(query);
  if (!outcome.ok) return fail(LOOKUP_MESSAGES[outcome.reason]);

  const { toCandidateView } = await import("@/server/geo/providers");
  return ok({ candidates: outcome.candidates.map(toCandidateView) });
}

// --- helpers ---------------------------------------------------------------

/**
 * The `isPrivate` value an edit is allowed to write.
 *
 * Flipping the marker while the lock is closed would make the row vanish with
 * no way back to it — the same reason `setPrivate` refuses — so an edit that
 * tries is rejected rather than quietly dropped. Leaving it where it already is
 * always passes, so fixing a typo on a visible row never asks for the PIN.
 */
async function privacyMarker(
  form: FormData,
  current: boolean,
): Promise<{ ok: true; isPrivate: boolean } | { ok: false; error: string }> {
  const wanted = bool(form, "isPrivate");
  if (wanted === current) return { ok: true, isPrivate: current };

  const scope = await privacyScope();
  if (scope.enabled && !scope.unlocked) {
    return { ok: false, error: "Unlock privacy before changing this." };
  }
  return { ok: true, isPrivate: wanted };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function recurrenceOf(value?: string): "NONE" | "ANNUAL" | "MONTHLY" {
  return value === "NONE" || value === "MONTHLY" ? value : "ANNUAL";
}

function priorityOf(value?: string): "LOW" | "NORMAL" | "HIGH" {
  return value === "LOW" || value === "HIGH" ? value : "NORMAL";
}

function giftStatusOf(value?: string): "IDEA" | "RESERVED" | "PURCHASED" | "GIVEN" {
  return value === "RESERVED" || value === "PURCHASED" || value === "GIVEN" ? value : "IDEA";
}

function debtDirectionOf(value?: string): "THEY_OWE_ME" | "I_OWE_THEM" {
  return value === "I_OWE_THEM" ? "I_OWE_THEM" : "THEY_OWE_ME";
}

function reminderPolicy(
  form: FormData,
): { ok: true; value: number[] | null } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      value: parseReminderDays(str(form, "reminderMode"), str(form, "reminderDaysBefore")),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid reminder policy." };
  }
}
