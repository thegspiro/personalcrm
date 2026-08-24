"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import {
  type ActionResult,
  bool,
  fail,
  num,
  ok,
  owner,
  partialDate,
  plainDate,
  str,
} from "./helpers";

/**
 * Everything that hangs off a contact: facts, important dates, life events,
 * ideas, tasks, gifts, and relationships.
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

// --- facts -----------------------------------------------------------------

export async function createFact(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  const contactId = str(form, "contactId");
  const content = str(form, "content");
  if (!contactId || !content) return fail("Write something to remember.");
  if (!(await ownsContact(ownerId, contactId))) return fail("Contact not found.");

  const created = await prisma.fact.create({
    data: {
      ownerId,
      contactId,
      content,
      categoryId: str(form, "categoryId") ?? null,
      importance: clamp(num(form, "importance") ?? 1, 0, 2),
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

  const existing = await prisma.fact.findFirst({ where: { id, ownerId }, select: { contactId: true } });
  if (!existing) return fail("Not found.");

  await prisma.fact.update({
    where: { id },
    data: {
      content,
      categoryId: str(form, "categoryId") ?? null,
      importance: clamp(num(form, "importance") ?? 1, 0, 2),
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

  const created = await prisma.importantDate.create({
    data: {
      ownerId,
      contactId,
      label,
      typeId: str(form, "typeId") ?? null,
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
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const when = partialDate(form, "date");
  const label = str(form, "label");
  if (!label || !when) return fail("A label and a date are required.");

  await prisma.importantDate.update({
    where: { id },
    data: {
      label,
      typeId: str(form, "typeId") ?? null,
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
    where: { id, ownerId },
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

  const created = await prisma.lifeEvent.create({
    data: {
      ownerId,
      contactId,
      title,
      typeId: str(form, "typeId") ?? null,
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
    where: { id, ownerId },
    select: { contactId: true },
  });
  if (!existing) return fail("Not found.");

  const title = str(form, "title");
  const when = partialDate(form, "date");
  if (!title || !when) return fail("A title and a date are required.");
  const end = partialDate(form, "endDate");

  await prisma.lifeEvent.update({
    where: { id },
    data: {
      title,
      typeId: str(form, "typeId") ?? null,
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
    where: { id, ownerId },
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

  const created = await prisma.gift.create({
    data: {
      ownerId,
      contactId,
      name,
      description: str(form, "description") ?? null,
      url: str(form, "url") ?? null,
      priceCents: price === undefined ? null : Math.round(price * 100),
      occasionId: str(form, "occasionId") ?? null,
      status: giftStatusOf(str(form, "status")),
      direction: str(form, "direction") === "INCOMING" ? "INCOMING" : "OUTGOING",
      occurredOn: plainDate(form, "occurredOn") ?? null,
    },
  });

  touch(contactId);
  revalidatePath("/gifts");
  return ok({ id: created.id });
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
