"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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
const TAKEN = "A tag with that name already exists.";

/** A tag this account does not have, or no longer has. */
const NOT_FOUND = "Tag not found.";

/** The `(ownerId, slug)` unique key, met by a race rather than a check. */
function isDuplicateSlug(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * A tag that existed when this action looked and did not when it wrote.
 *
 * Every write here reads first, and another tab can delete the row in
 * between: an update then raises P2025 and an insert referencing it P2003.
 * Both escaped as server errors on what is, from the person's point of view,
 * simply a tag that is no longer there — the same outcome the read would have
 * reported a moment later, and it should read the same way.
 */
function isVanishedTag(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2025" || error.code === "P2003")
  );
}

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
  if (exists) return fail(TAKEN);
  try {
    await prisma.tag.create({ data: { ownerId, name: parsed.data, slug } });
  } catch (error) {
    // Two tabs, or two clients, can both pass the check above before either
    // insert commits. The loser then met the unique key as a server error
    // rather than the sentence the first click would have got, which is the
    // same outcome by a different route and should read the same way.
    if (isDuplicateSlug(error)) return fail(TAKEN);
    throw error;
  }
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
  const MISSING = "Contact or tag not found.";
  if (!contact || !tag) return fail(MISSING);
  if (assigned)
    try {
      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId, tagId } },
        create: { contactId, tagId },
        update: {},
      });
    } catch (error) {
      if (isVanishedTag(error)) return fail(MISSING);
      throw error;
    }
  else await prisma.contactTag.deleteMany({ where: { contactId, tagId } });
  refresh(contactId);
  return ok();
}

export async function renameTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const parsed = tagName.safeParse(str(form, "name"));
  if (!id) return fail(NOT_FOUND);
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
  if (!tag) return fail(NOT_FOUND);
  const collision = await prisma.tag.findFirst({
    where: { ownerId, slug, NOT: { id } },
    select: { id: true },
  });
  const RENAMED_ONTO = "That name is already used. Merge the tags instead.";
  if (collision) return fail(RENAMED_ONTO);
  try {
    await prisma.tag.update({ where: { id }, data: { name: parsed.data, slug } });
  } catch (error) {
    // The same race as `createTag`, from the other direction.
    if (isDuplicateSlug(error)) return fail(RENAMED_ONTO);
    if (isVanishedTag(error)) return fail(NOT_FOUND);
    throw error;
  }
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
  if (tags !== 2) return fail(NOT_FOUND);
  if (await touchesHiddenContacts(ownerId, [sourceId, destinationId]))
    return fail("Unlock to merge a tag that is on someone private.");
  const merged = await prisma.$transaction(async (tx) => {
    // Both rows are locked, not merely counted again, and the count above is
    // no substitute: it ran before the transaction opened, and a repeatable
    // read would answer from a snapshot even if it ran inside.
    //
    // Another tab deleting the destination in that window did not fail
    // loudly. `createMany` with `skipDuplicates` is `INSERT IGNORE` on
    // MariaDB, and `INSERT IGNORE` demotes a foreign-key violation to a
    // warning and drops the row — so every assignment was silently discarded
    // and the source tag then deleted on top, taking the tag off people who
    // had it and reporting success. Deleting the *source* in that window was
    // merely noisy: `delete` raised P2025, which escaped as a server error
    // rather than the sentence a tag that is no longer there deserves.
    //
    // `FOR UPDATE` is a current read rather than a snapshot one, so it sees a
    // delete that committed after this transaction began, and it holds both
    // rows until the merge commits, so one cannot commit during it. InnoDB
    // takes the locks in index order, which is the primary key here and so
    // the same order whichever tag is the source — two merges of the same
    // pair queue rather than deadlock.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM Tag
      WHERE ownerId = ${ownerId} AND id IN (${sourceId}, ${destinationId})
      FOR UPDATE
    `;
    if (locked.length !== 2) return false;
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
    return true;
  });
  if (!merged) return fail(NOT_FOUND);
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
  if (!tag) return fail(NOT_FOUND);
  // The assignments go with it by cascade, private ones included.
  if (await touchesHiddenContacts(ownerId, [id]))
    return fail("Unlock to delete a tag that is on someone private.");
  const result = await prisma.tag.deleteMany({ where: { id, ownerId } });
  if (!result.count) return fail(NOT_FOUND);
  refresh();
  return ok();
}
