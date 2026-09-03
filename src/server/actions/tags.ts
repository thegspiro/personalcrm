"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeTagSlug } from "@/lib/tags";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { tagVisibleWhere } from "@/server/queries/tags";
import { fail, invalid, ok, owner, str, type ActionResult } from "./helpers";

const tagName = z.string().trim().min(1, "A tag name is required.").max(96);

function refresh(contactId?: string) {
  revalidatePath("/people");
  revalidatePath("/settings");
  if (contactId) revalidatePath(`/people/${contactId}`);
}

/**
 * Whether the tag namespace may be changed right now.
 *
 * Creating or renaming necessarily answers "is this name already taken", and
 * a name that is taken but belongs to a tag you cannot see is one the lock is
 * hiding — a tag used only by private people. Guess it and the collision
 * confirms it; ask for a free name and it saves. That is an oracle for the
 * labels someone put on their private contacts, and, as with renaming a
 * place, the signal is the refusal rather than the sentence, so softer wording
 * would not help. Both are held back until an unlock; assigning an existing
 * tag, which changes no name, stays available.
 */
async function namespaceLocked(): Promise<boolean> {
  const scope = await privacyScope();
  return scope.enabled && !scope.unlocked;
}

export async function createTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const parsed = tagName.safeParse(str(form, "name"));
  if (!parsed.success) return invalid(parsed.error);
  const slug = normalizeTagSlug(parsed.data);
  if (!slug) return fail("Use at least one letter or number.");
  if (await namespaceLocked())
    return fail("Unlock to add a tag.");
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
    // The tag has to be one the lock is currently showing, not merely one the
    // account owns. This takes an id straight off a page that may have been
    // rendered before the lock closed, and a tag living only on private people
    // is exactly what must not be assignable from a locked session.
    prisma.tag.findFirst({
      where: { id: tagId, ...tagVisibleWhere(ownerId, scope) },
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
  if (await namespaceLocked())
    return fail("Unlock to rename a tag.");
  // Scoped as well as owner-checked. Settings rendered while unlocked keeps
  // every id it listed, and closing the lock in another tab does not empty
  // that form, so ownership alone would let a stale one rename a tag the lock
  // is now hiding.
  const scope = await privacyScope();
  const tag = await prisma.tag.findFirst({
    where: { id, ...tagVisibleWhere(ownerId, scope) },
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
async function touchesHiddenContacts(
  ownerId: string,
  tagIds: string[],
): Promise<boolean> {
  const scope = await privacyScope();
  if (scope.unlocked) return false;
  // Owner-scoped on both sides. Unscoped, submitting another account's tag id
  // answered from their rows: the unlock message when their tag was on one of
  // their private contacts, "Tag not found" otherwise — a difference that is
  // itself a fact about an account this one cannot see.
  const hidden = await prisma.contactTag.count({
    where: {
      tagId: { in: tagIds },
      tag: { ownerId },
      contact: { ownerId, isPrivate: true },
    },
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
  if (await touchesHiddenContacts(ownerId, [sourceId, destinationId]))
    return fail("Unlock to merge a tag that is on someone private.");
  await prisma.$transaction(async (tx) => {
    const assignments = await tx.contactTag.findMany({
      // Scoped by the contact's owner, not merely the tag's. The two are
      // independent foreign keys, so an import or a restore can join this
      // account's tag to another account's person — and copying that row onto
      // the destination would have made this account the author of a
      // cross-owner association it cannot see. Such a row is left where it is
      // rather than carried forward.
      where: { tagId: sourceId, contact: { ownerId } },
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
  // Ownership first, so a tag that is not this account's gets the same "not
  // found" whatever is assigned to it. Probing before this answered from the
  // other account's rows.
  const tag = await prisma.tag.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!tag) return fail("Tag not found.");
  // The assignments go with it by cascade, private ones included.
  if (await touchesHiddenContacts(ownerId, [id]))
    return fail("Unlock to delete a tag that is on someone private.");
  const result = await prisma.tag.deleteMany({ where: { id, ownerId } });
  if (!result.count) return fail("Tag not found.");
  refresh();
  return ok();
}
