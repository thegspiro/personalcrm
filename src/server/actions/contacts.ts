"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { recomputeContactActivity } from "@/server/services/contact-activity";
import {
  customFieldFailure,
  deleteCustomFieldValues,
  saveCustomFieldValuesOrThrow,
} from "@/server/services/custom-field-values";
import { snoozeUntil as snoozeDate } from "@/lib/cadence";
import {
  AvatarValidationError,
  removeAvatarFile,
  storeAvatar,
} from "@/server/services/avatars";
import {
  contactPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";
import { lockedTagsUsable } from "@/server/queries/tags";
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

/**
 * Replace a contact's tags with the set `lockSubmittedTags` has already
 * approved and is holding.
 *
 * The two halves used to be here together, and the ordering rule separated
 * them: whether the lock is currently showing a tag is a locking read, and
 * every locking read that can wait has to happen before the transaction takes
 * its read view. So the question is asked at the top of the transaction and
 * this only writes the answer. What it is guarding against is unchanged — a
 * contact form loaded while unlocked keeps the ids of every tag it listed, and
 * closing the lock in another tab does not empty that form, so submitting it
 * would otherwise carry a tag that exists only on private people onto a
 * visible contact, publishing the hidden tag's name through its new visible
 * use.
 */
async function replaceTags(
  tx: Prisma.TransactionClient,
  ownerId: string,
  contactId: string,
  tagIds: string[],
) {
  await tx.contactTag.deleteMany({ where: { contactId } });
  if (tagIds.length)
    await tx.contactTag.createMany({
      // One owner on the row, referenced by both foreign keys, so the contact
      // and the tag cannot belong to different accounts.
      data: tagIds.map((tagId) => ({ ownerId, contactId, tagId })),
    });
}

/**
 * Hold the submitted tags for the transaction, as its very first statement.
 *
 * Counting them and then inserting left a gap: another tab deleting one in
 * between met the foreign key as a P2003, which nothing here translates, so an
 * ordinary tag deletion elsewhere turned a whole contact save into a server
 * error and rolled back the contact, its custom fields and its avatar with it.
 * Held, the tag cannot go anywhere and the save keeps it.
 *
 * *First*, though, is not a stylistic preference. A locking read taken after
 * the transaction has already established a read view — after the contact row
 * is written, say — and which then waits on the very delete it is guarding
 * against, comes back as "Record has changed since last read" (MariaDB error
 * 1020) instead of as a row count. That turned one server error into another,
 * on MariaDB 11 but not on 10.11, so it appeared only in CI. Nothing has been
 * read when this runs, so there is no view for the lock to disagree with,
 * which is also why the tag actions have always taken theirs first.
 *
 * Owner-scoped, so a tag belonging to another account is simply not returned
 * and gets the same answer without anything of theirs being read. Returns the
 * deduplicated ids, so the caller counts and writes each exactly once.
 */
async function lockSubmittedTags(
  tx: Prisma.TransactionClient,
  ownerId: string,
  scope: PrivacyScope,
  tagIds: string[],
): Promise<string[]> {
  const unique = [...new Set(tagIds)];
  if (!unique.length) return unique;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Tag
    WHERE ownerId = ${ownerId} AND id IN (${Prisma.join(unique)})
    FOR UPDATE
  `;
  if (locked.length !== unique.length) throw new InvalidTagError();
  // Whether the lock is currently showing them, decided here rather than in
  // `replaceTags`, because it is a locking read that can wait and every one of
  // those has to precede the transaction's first consistent read — waiting on
  // a row and then finding it changed since that read view is MariaDB 11's
  // error 1020 rather than a result. Ownership and existence are settled
  // above; this is the privacy half, and it holds the assignments it reads.
  if (!(await lockedTagsUsable(tx, ownerId, scope, unique)))
    throw new InvalidTagError();
  return unique;
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
  const scope = await privacyScope();
  const found = await prisma.contact.findFirst({
    where: { id: contactId, ownerId, ...contactPrivacyWhere(scope) },
    select: { id: true },
  });
  return Boolean(found);
}

export async function createContact(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();
  // Read before the transaction opens, so the cookie the lock lives in is not
  // consulted with one held.
  const scope = await privacyScope();

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

  const avatar = form.get("avatar");
  let storedAvatar: Awaited<ReturnType<typeof storeAvatar>> | null = null;
  if (avatar instanceof File && avatar.size > 0) {
    try {
      storedAvatar = await storeAvatar(avatar);
    } catch (error) {
      if (error instanceof AvatarValidationError) return fail(error.message);
      // A misconfigured UPLOADS_DIR or a full volume: the operator's to fix,
      // so it is logged where they look rather than shown where they don't.
      console.error("Unable to store an avatar", error);
      return fail("The avatar could not be stored.");
    }
  }

  // Wrapped so an invalid custom field aborts the whole create: a contact that
  // saves while one of its fields silently doesn't is worse than a failure.
  let contact: { id: string };
  try {
    contact = await prisma.$transaction(async (tx) => {
      // Before the contact row, so the lock is the transaction's first
      // statement — see `lockSubmittedTags`.
      const tagIds = await lockSubmittedTags(tx, ownerId, scope, strList(form, "tagIds"));
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
          avatarPath: storedAvatar?.publicPath ?? null,
        },
      });

      await saveCustomFieldValuesOrThrow(
        tx,
        ownerId,
        "CONTACT",
        created.id,
        form,
      );
      await replaceTags(tx, ownerId, created.id, tagIds);
      // A new contact has no interactions, but this seeds nextTouchAt from their
      // creation date so a cadence starts counting immediately.
      await recomputeContactActivity(tx, [created.id]);
      return created;
    });
  } catch (error) {
    await removeAvatarFile(storedAvatar?.publicPath ?? null).catch(() => {});
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
  const scope = await privacyScope();
  const existing = await prisma.contact.findFirst({
    where: { id, ownerId, ...contactPrivacyWhere(scope) },
    select: { id: true, avatarPath: true },
  });
  if (!existing) return fail("Contact not found.");

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

  const avatar = form.get("avatar");
  const removeAvatar = bool(form, "removeAvatar");
  let storedAvatar: Awaited<ReturnType<typeof storeAvatar>> | null = null;
  if (avatar instanceof File && avatar.size > 0) {
    try {
      storedAvatar = await storeAvatar(avatar);
    } catch (error) {
      if (error instanceof AvatarValidationError) return fail(error.message);
      // A misconfigured UPLOADS_DIR or a full volume: the operator's to fix,
      // so it is logged where they look rather than shown where they don't.
      console.error("Unable to store an avatar", error);
      return fail("The avatar could not be stored.");
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // First, as in `createContact` and for the same reason.
      const tagIds = await lockSubmittedTags(tx, ownerId, scope, strList(form, "tagIds"));
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
          ...(storedAvatar
            ? { avatarPath: storedAvatar.publicPath }
            : removeAvatar
              ? { avatarPath: null }
              : {}),
        },
      });

      await saveCustomFieldValuesOrThrow(tx, ownerId, "CONTACT", id, form);
      await replaceTags(tx, ownerId, id, tagIds);
      // The cadence may have changed, so nextTouchAt has to be re-derived.
      await recomputeContactActivity(tx, [id]);
    });
  } catch (error) {
    await removeAvatarFile(storedAvatar?.publicPath ?? null).catch(() => {});
    if (error instanceof InvalidTagError) return fail("One or more tags are unavailable.");
    const failure = customFieldFailure(error);
    if (failure) return failure;
    throw error;
  }

  if (storedAvatar || removeAvatar) {
    // The database points only at a fully published new file (or null) before
    // obsolete bytes are removed. A cleanup failure can therefore leave an
    // unreferenced file, but never a broken Contact.avatarPath.
    await removeAvatarFile(existing.avatarPath).catch((error) => {
      console.error("Unable to remove obsolete avatar", error);
    });
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
  const scope = await privacyScope();
  const contact = await prisma.contact.findFirst({
    where: { id, ownerId, ...contactPrivacyWhere(scope) },
    select: { avatarPath: true },
  });
  if (!contact) return fail("Contact not found.");

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

  // Delete the row first: if unlink fails the only consequence is an orphan,
  // never a database path to a file that no longer exists.
  await removeAvatarFile(contact.avatarPath).catch((error) => {
    console.error("Unable to remove deleted contact avatar", error);
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
