"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeTagSlug } from "@/lib/tags";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { fail, invalid, ok, owner, str, type ActionResult } from "./helpers";

const tagName = z.string().trim().min(1, "A tag name is required.").max(96);

function refresh(contactId?: string) {
  revalidatePath("/people");
  revalidatePath("/settings");
  if (contactId) revalidatePath(`/people/${contactId}`);
}

export async function createTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const parsed = tagName.safeParse(str(form, "name"));
  if (!parsed.success) return invalid(parsed.error);
  const slug = normalizeTagSlug(parsed.data);
  if (!slug) return fail("Use at least one letter or number.");
  const exists = await prisma.tag.findUnique({
    where: { ownerId_slug: { ownerId, slug } },
  });
  if (exists) return fail("A tag with that name already exists.");
  await prisma.tag.create({ data: { ownerId, name: parsed.data, slug } });
  refresh();
  return ok();
}

export async function setContactTag(
  contactId: string,
  tagId: string,
  assigned: boolean,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  const scope = await privacyScope();
  const [contact, tag] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, ownerId, ...contactPrivacyWhere(scope) },
      select: { id: true },
    }),
    prisma.tag.findFirst({
      where: { id: tagId, ownerId },
      select: { id: true },
    }),
  ]);
  if (!contact || !tag) return fail("Contact or tag not found.");
  if (assigned)
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId } },
      create: { contactId, tagId },
      update: {},
    });
  else await prisma.contactTag.deleteMany({ where: { contactId, tagId } });
  refresh(contactId);
  return ok();
}

export async function renameTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const parsed = tagName.safeParse(str(form, "name"));
  if (!id) return fail("Tag not found.");
  if (!parsed.success) return invalid(parsed.error);
  const slug = normalizeTagSlug(parsed.data);
  if (!slug) return fail("Use at least one letter or number.");
  const tag = await prisma.tag.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!tag) return fail("Tag not found.");
  const collision = await prisma.tag.findFirst({
    where: { ownerId, slug, NOT: { id } },
    select: { id: true },
  });
  if (collision)
    return fail("That name is already used. Merge the tags instead.");
  await prisma.tag.update({ where: { id }, data: { name: parsed.data, slug } });
  refresh();
  return ok();
}

/** Move every assignment to the destination, deduplicate, then remove the source. */
/**
 * Whether a tag is on anyone the closed lock is hiding.
 *
 * A tag used by one visible person and one private one stays listed while
 * locked, because the visible use is reason enough to show it. Merging or
 * deleting it from that session would move or destroy the private
 * association too — a change to a record the session cannot see, made by a
 * session that cannot see it. Both refuse instead.
 */
async function touchesHiddenContacts(tagIds: string[]): Promise<boolean> {
  const scope = await privacyScope();
  if (scope.unlocked) return false;
  const hidden = await prisma.contactTag.count({
    where: { tagId: { in: tagIds }, contact: { isPrivate: true } },
  });
  return hidden > 0;
}

export async function mergeTag(
  sourceId: string,
  destinationId: string,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (sourceId === destinationId)
    return fail("Choose a different destination tag.");
  const tags = await prisma.tag.count({
    where: { ownerId, id: { in: [sourceId, destinationId] } },
  });
  if (tags !== 2) return fail("Tag not found.");
  if (await touchesHiddenContacts([sourceId, destinationId]))
    return fail("Unlock to merge a tag that is on someone private.");
  await prisma.$transaction(async (tx) => {
    const assignments = await tx.contactTag.findMany({
      where: { tagId: sourceId },
      select: { contactId: true },
    });
    if (assignments.length)
      await tx.contactTag.createMany({
        data: assignments.map(({ contactId }) => ({
          contactId,
          tagId: destinationId,
        })),
        skipDuplicates: true,
      });
    await tx.tag.delete({ where: { id: sourceId } });
  });
  refresh();
  return ok();
}

/** Deleting a tag removes only its join rows; contacts themselves are preserved. */
export async function deleteTag(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  // The assignments go with it by cascade, private ones included.
  if (await touchesHiddenContacts([id]))
    return fail("Unlock to delete a tag that is on someone private.");
  const result = await prisma.tag.deleteMany({ where: { id, ownerId } });
  if (!result.count) return fail("Tag not found.");
  refresh();
  return ok();
}
