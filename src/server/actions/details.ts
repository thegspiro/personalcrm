"use server";

import { randomBytes } from "node:crypto";
import type { TaxonomyKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import {
  debtPrivacyWhere,
  factPrivacyWhere,
  privacyScope,
  viaContactPrivacyWhere,
} from "@/server/privacy/filter";
import { calendarDateInTz, plainDateFromDb, plainDateToDb } from "@/lib/dates";
import { isValidPartialDateRange } from "@/lib/date-precision";
import { dietaryKindOf } from "@/lib/dietary";
import {
  type ActionResult,
  bool,
  fail,
  fieldError,
  num,
  ok,
  owner,
  partialDate,
  plainDate,
  str,
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

async function ownsContact(ownerId: string, contactId: string): Promise<boolean> {
  return Boolean(
    await prisma.contact.findFirst({ where: { id: contactId, ownerId }, select: { id: true } }),
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
  const existing = await prisma.fact.findFirst({
    where: { id, ownerId, ...factPrivacyWhere(await privacyScope()) },
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
  const existing = await prisma.fact.findFirst({ where: { id, ownerId }, select: { contactId: true } });
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
      reminderDaysBefore: parseReminderDays(str(form, "reminderDaysBefore")),
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

  await prisma.importantDate.update({
    where: { id },
    data: {
      label,
      typeId: type.id,
      date: when.date,
      precision: when.precision,
      recurrence: recurrenceOf(str(form, "recurrence")),
      notes: str(form, "notes") ?? null,
      reminderDaysBefore: parseReminderDays(str(form, "reminderDaysBefore")),
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
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateLifeEvent(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing event.");
  const existing = await prisma.lifeEvent.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
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

  await prisma.lifeEvent.update({
    where: { id },
    data: {
      title,
      typeId: type.id,
      description: str(form, "description") ?? null,
      date: when.date,
      precision: when.precision,
      endDate: end?.date ?? null,
      endPrecision: end?.precision ?? null,
      isMilestone: bool(form, "isMilestone"),
    },
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteLifeEvent(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.lifeEvent.findFirst({
    where: { id, ownerId, ...viaContactPrivacyWhere(await privacyScope()) },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.lifeEvent.delete({ where: { id } });
  touch(existing.contactId);
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
    where: { id, ownerId },
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
  const existing = await prisma.idea.findFirst({ where: { id, ownerId }, select: { contactId: true } });
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
  const existing = await prisma.idea.findFirst({ where: { id, ownerId }, select: { contactId: true } });
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

  const cost = num(form, "estimatedCost");
  return {
    categoryId,
    location: str(form, "location") ?? null,
    city: str(form, "city") ?? null,
    url: str(form, "url") ?? null,
    estimatedCostCents: cost === undefined ? null : Math.round(cost * 100),
    notes: str(form, "notes") ?? null,
    plannedFor: plainDate(form, "plannedFor") ?? null,
  };
}

export async function createPlan(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const title = str(form, "title");
  if (!title) return fail("What do you want to do?");

  const contactId = str(form, "contactId") ?? null;
  if (contactId && !(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const fields = await planFields(ownerId, form);
  if (!fields) return fail("Unknown category.");

  const created = await prisma.plan.create({
    data: {
      ownerId,
      contactId,
      title,
      status: planStatusOf(str(form, "status")),
      ...fields,
    },
  });

  touchPlans(contactId);
  return ok({ id: created.id });
}

export async function updatePlan(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing plan.");

  const existing = await prisma.plan.findFirst({
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const title = str(form, "title");
  if (!title) return fail("What do you want to do?");

  const fields = await planFields(ownerId, form);
  if (!fields) return fail("Unknown category.");

  await prisma.plan.update({ where: { id }, data: { title, ...fields } });

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
    where: { id, ownerId },
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
    where: { id, ownerId },
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
  if (!title) return fail("Give the follow-up a name.");
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
 * Correct a follow-up.
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
  if (!id || !title) return fail("Give the follow-up a name.");

  const existing = await prisma.task.findFirst({
    where: { id, ownerId },
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
  const existing = await prisma.task.findFirst({ where: { id, ownerId }, select: { contactId: true } });
  if (!existing) return fail("Not found.");

  await prisma.task.update({ where: { id }, data: { completedAt: done ? new Date() : null } });
  touch(existing.contactId);
  revalidatePath("/tasks");
  return ok();
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.task.findFirst({ where: { id, ownerId }, select: { contactId: true } });
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
    where: { id, ownerId },
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
  const existing = await prisma.gift.findFirst({ where: { id, ownerId }, select: { contactId: true } });
  if (!existing) return fail("Not found.");
  await prisma.gift.update({ where: { id }, data: { status } });
  touch(existing.contactId);
  revalidatePath("/gifts");
  return ok();
}

export async function deleteGift(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.gift.findFirst({ where: { id, ownerId }, select: { contactId: true } });
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
  const existing = await prisma.debt.findFirst({
    where: { id, ownerId, ...debtPrivacyWhere(await privacyScope()) },
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
  const existing = await prisma.debt.findFirst({
    where: { id, ownerId },
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
  const existing = await prisma.debt.findFirst({
    where: { id, ownerId },
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

  const created = await prisma.dietaryNeed.create({
    data: {
      ownerId,
      contactId,
      kind: dietaryKindOf(str(form, "kind")),
      label,
      notes: str(form, "notes") ?? null,
      carriesEpinephrine: bool(form, "carriesEpinephrine"),
    },
  });

  touch(contactId);
  return ok({ id: created.id });
}

export async function updateDietaryNeed(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const label = str(form, "label");
  if (!id || !label) return fail("What can't they have?");

  const existing = await prisma.dietaryNeed.findFirst({
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.dietaryNeed.update({
    where: { id },
    data: {
      kind: dietaryKindOf(str(form, "kind")),
      label,
      notes: str(form, "notes") ?? null,
      carriesEpinephrine: bool(form, "carriesEpinephrine"),
    },
  });

  touch(existing.contactId);
  return ok();
}

export async function deleteDietaryNeed(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.dietaryNeed.findFirst({
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.dietaryNeed.delete({ where: { id } });
  touch(existing.contactId);
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
  const fromContactId = str(form, "fromContactId");
  const toContactId = str(form, "toContactId");
  const typeId = str(form, "typeId");
  if (!fromContactId || !toContactId || !typeId) return fail("Pick a person and a relationship.");
  if (fromContactId === toContactId) return fail("Someone can't be related to themselves.");

  const [from, to, type] = await Promise.all([
    prisma.contact.findFirst({ where: { id: fromContactId, ownerId }, select: { id: true } }),
    prisma.contact.findFirst({ where: { id: toContactId, ownerId }, select: { id: true } }),
    prisma.taxonomyTerm.findFirst({
      where: { id: typeId, ownerId, kind: "RELATIONSHIP_TYPE" },
      select: { id: true, inverseTermId: true },
    }),
  ]);
  if (!from || !to) return fail("Contact not found.");
  if (!type) return fail("Unknown relationship type.");

  const pairId = randomBytes(8).toString("hex");
  const inverseTypeId = type.inverseTermId ?? type.id;

  await prisma.$transaction(async (tx) => {
    await tx.relationship.upsert({
      where: {
        fromContactId_toContactId_typeId: { fromContactId, toContactId, typeId: type.id },
      },
      create: { ownerId, fromContactId, toContactId, typeId: type.id, pairId },
      update: { pairId },
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
      },
      update: { pairId },
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
    where: { id, ownerId },
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
    where: { id, ownerId },
    select: { pairId: true, fromContactId: true, toContactId: true },
  });
  if (!existing) return fail("Not found.");

  // Remove both halves of the pair, so the reciprocal doesn't linger.
  await prisma.relationship.deleteMany({ where: { ownerId, pairId: existing.pairId } });

  touch(existing.fromContactId);
  touch(existing.toContactId);
  return ok();
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

/** "30, 7, 0" -> [30, 7, 0]; empty falls back to the account default. */
function parseReminderDays(raw?: string): number[] | undefined {
  if (!raw) return undefined;
  const days = raw
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365)
    .map((n) => Math.round(n));
  return days.length > 0 ? [...new Set(days)].sort((a, b) => b - a) : undefined;
}
