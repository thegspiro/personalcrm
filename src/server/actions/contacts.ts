"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { recomputeContactActivity } from "@/server/services/contact-activity";
import {
  customFieldFailure,
  deleteCustomFieldValues,
  saveCustomFieldValuesOrThrow,
} from "@/server/services/custom-field-values";
import { snoozeUntil as snoozeDate } from "@/lib/cadence";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import {
  type ActionResult,
  bool,
  fail,
  invalid,
  num,
  ok,
  owner,
  partialDate,
  str,
  strList,
} from "./helpers";

async function replaceTags(
  tx: Prisma.TransactionClient,
  ownerId: string,
  contactId: string,
  tagIds: string[],
) {
  const unique = [...new Set(tagIds)];
  const owned = unique.length
    ? await tx.tag.count({ where: { ownerId, id: { in: unique } } })
    : 0;
  if (owned !== unique.length) throw new InvalidTagError();
  await tx.contactTag.deleteMany({ where: { contactId } });
  if (unique.length)
    await tx.contactTag.createMany({
      data: unique.map((tagId) => ({ contactId, tagId })),
    });
}

class InvalidTagError extends Error {}

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "A first name is required.").max(120),
  lastName: z.string().trim().max(120).optional(),
  // Bounded to the column width, so an over-long value comes back as a field
  // error rather than a database rejection thrown out of the action. The form
  // mirrors these with `maxLength`, which stops it happening in the first place
  // without being the thing relied on — a server action is a public POST.
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  whereWeMet: z.string().trim().max(191).optional(),
});

function revalidateContact(id?: string) {
  revalidatePath("/");
  revalidatePath("/people");
  revalidatePath("/timeline");
  if (id) revalidatePath(`/people/${id}`);
}

/** Assert a row belongs to the signed-in user before touching it. */
async function assertOwnedContact(
  ownerId: string,
  contactId: string,
): Promise<boolean> {
  const found = await prisma.contact.findFirst({
    where: { id: contactId, ownerId },
    select: { id: true },
  });
  return Boolean(found);
}

export async function createContact(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();

  const parsed = nameSchema.safeParse({
    firstName: str(form, "firstName"),
    lastName: str(form, "lastName"),
    city: str(form, "city"),
    region: str(form, "region"),
    country: str(form, "country"),
    whereWeMet: str(form, "whereWeMet"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const birth = partialDate(form, "birthDate");
  const met = partialDate(form, "metOn");
  const cadenceDays = num(form, "cadenceDays");

  // Wrapped so an invalid custom field aborts the whole create: a contact that
  // saves while one of its fields silently doesn't is worse than a failure.
  let contact: { id: string };
  try {
    contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          ownerId,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName ?? null,
          nickname: str(form, "nickname") ?? null,
          pronouns: str(form, "pronouns") ?? null,
          categoryId: str(form, "categoryId") ?? null,
          occupation: str(form, "occupation") ?? null,
          employer: str(form, "employer") ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          country: parsed.data.country ?? null,
          summary: str(form, "summary") ?? null,
          howWeMet: str(form, "howWeMet") ?? null,
          whereWeMet: parsed.data.whereWeMet ?? null,
          meetingSourceId: str(form, "meetingSourceId") ?? null,
          birthDate: birth?.date ?? null,
          birthDatePrecision: birth?.precision ?? "DAY",
          metOn: met?.date ?? null,
          metOnPrecision: met?.precision ?? "DAY",
          cadenceDays:
            cadenceDays && cadenceDays > 0 ? Math.round(cadenceDays) : null,
          isFavorite: bool(form, "isFavorite"),
          isRomantic: bool(form, "isRomantic"),
        },
      });

      await saveCustomFieldValuesOrThrow(
        tx,
        ownerId,
        "CONTACT",
        created.id,
        form,
      );
      await replaceTags(tx, ownerId, created.id, strList(form, "tagIds"));
      // A new contact has no interactions, but this seeds nextTouchAt from their
      // creation date so a cadence starts counting immediately.
      await recomputeContactActivity(tx, [created.id]);
      return created;
    });
  } catch (error) {
    if (error instanceof InvalidTagError) return fail("One or more tags are unavailable.");
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateContact(contact.id);
  return ok({ id: contact.id });
}

export async function updateContact(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  if (!id) return fail("Missing contact.");
  if (!(await assertOwnedContact(ownerId, id)))
    return fail("Contact not found.");

  const parsed = nameSchema.safeParse({
    firstName: str(form, "firstName"),
    lastName: str(form, "lastName"),
    city: str(form, "city"),
    region: str(form, "region"),
    country: str(form, "country"),
    whereWeMet: str(form, "whereWeMet"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const birth = partialDate(form, "birthDate");
  const met = partialDate(form, "metOn");
  const cadenceDays = num(form, "cadenceDays");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName ?? null,
          nickname: str(form, "nickname") ?? null,
          pronouns: str(form, "pronouns") ?? null,
          categoryId: str(form, "categoryId") ?? null,
          occupation: str(form, "occupation") ?? null,
          employer: str(form, "employer") ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          country: parsed.data.country ?? null,
          summary: str(form, "summary") ?? null,
          howWeMet: str(form, "howWeMet") ?? null,
          whereWeMet: parsed.data.whereWeMet ?? null,
          meetingSourceId: str(form, "meetingSourceId") ?? null,
          birthDate: birth?.date ?? null,
          birthDatePrecision: birth?.precision ?? "DAY",
          metOn: met?.date ?? null,
          metOnPrecision: met?.precision ?? "DAY",
          cadenceDays:
            cadenceDays && cadenceDays > 0 ? Math.round(cadenceDays) : null,
          isFavorite: bool(form, "isFavorite"),
          isRomantic: bool(form, "isRomantic"),
        },
      });

      await saveCustomFieldValuesOrThrow(tx, ownerId, "CONTACT", id, form);
      await replaceTags(tx, ownerId, id, strList(form, "tagIds"));
      // The cadence may have changed, so nextTouchAt has to be re-derived.
      await recomputeContactActivity(tx, [id]);
    });
  } catch (error) {
    if (error instanceof InvalidTagError) return fail("One or more tags are unavailable.");
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  revalidateContact(id);
  return ok();
}

/** Edit the canonical birthday without creating an ImportantDate shadow row. */
export async function updateContactBirthday(
  form: FormData,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const birth = partialDate(form, "birthDate");
  if (!id || !birth) return fail("A birthday is required.");

  // A server action is a public POST endpoint. Besides ownership, apply the
  // live lock so a stale open sheet cannot edit a private contact after lock.
  const scope = await privacyScope();
  const contact = await prisma.contact.findFirst({
    where: { id, ownerId, ...contactPrivacyWhere(scope) },
    select: { id: true },
  });
  if (!contact) return fail("Contact not found.");

  await prisma.contact.update({
    where: { id },
    data: { birthDate: birth.date, birthDatePrecision: birth.precision },
  });
  revalidateContact(id);
  return ok();
}

/** Small field-level edits from the contact page, without a full form. */
export async function patchContact(
  id: string,
  patch: {
    cadenceDays?: number | null;
    isFavorite?: boolean;
    isArchived?: boolean;
    isRomantic?: boolean;
    summary?: string | null;
  },
): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!(await assertOwnedContact(ownerId, id)))
    return fail("Contact not found.");

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: patch });
    if (patch.cadenceDays !== undefined) {
      await recomputeContactActivity(tx, [id]);
    }
  });

  revalidateContact(id);
  return ok();
}

/** Push someone off the reach-out list for a while without logging a fake contact. */
export async function snoozeContact(
  id: string,
  days: number,
): Promise<ActionResult> {
  const { ownerId, timezone } = await owner();
  if (!(await assertOwnedContact(ownerId, id)))
    return fail("Contact not found.");
  if (!Number.isFinite(days) || days <= 0)
    return fail("Pick how long to snooze for.");

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id },
      data: { snoozedUntil: snoozeDate(Math.round(days), timezone) },
    });
    await recomputeContactActivity(tx, [id]);
  });

  revalidateContact(id);
  return ok();
}

export async function deleteContact(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!(await assertOwnedContact(ownerId, id)))
    return fail("Contact not found.");

  await prisma.$transaction(async (tx) => {
    // Custom field values key off a plain entityId with no foreign key, so
    // nothing cascades them away. The contact's interactions and dates go with
    // it, so their values have to be swept in the same breath.
    const [interactions, dates] = await Promise.all([
      tx.interaction.findMany({
        where: { ownerId, participants: { some: { contactId: id } } },
        select: { id: true },
      }),
      tx.dateEntry.findMany({
        where: { ownerId, contactId: id },
        select: { id: true },
      }),
    ]);
    await deleteCustomFieldValues(tx, ownerId, [
      { entity: "CONTACT", entityIds: [id] },
      { entity: "ROMANTIC", entityIds: [id] },
      { entity: "INTERACTION", entityIds: interactions.map((row) => row.id) },
      { entity: "DATE_ENTRY", entityIds: dates.map((row) => row.id) },
    ]);
    await tx.contact.delete({ where: { id } });
  });

  revalidateContact(id);
  return ok();
}

export async function setContactArchived(
  id: string,
  archived: boolean,
): Promise<ActionResult> {
  return patchContact(id, { isArchived: archived });
}
