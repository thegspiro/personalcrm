"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { normalizeTagSlug } from "@/lib/tags";
import { prisma } from "@/server/db/client";
import {
  contactPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";
import { tagVisibleWhere } from "@/server/queries/tags";
import { fail, fieldError, ok, owner, str, type ActionResult } from "./helpers";

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
 * A tag that existed when the rename looked and did not when it wrote.
 *
 * `renameTag` reads and then updates without holding the row, so another tab
 * can delete it in between; the update raises P2025, which escaped as a server
 * error on what is, from the person's point of view, simply a tag that is no
 * longer there. The paths that *insert* against a tag hold it instead of
 * catching afterwards, because their failure is not a Prisma code on every
 * server — see `lockContact`.
 */
function isVanishedTag(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

async function namespaceLocked(): Promise<boolean> {
  const scope = await privacyScope();
  return scope.enabled && !scope.unlocked;
}

/**
 * A schema failure on the name, named.
 *
 * `tagName` is a bare string schema, so its issues carry an empty path, and
 * `invalid()` keeps only issues that have one: the form was told to check the
 * highlighted fields with nothing highlighted and no word about what was
 * wrong. A whitespace-only name reaches this through `required`, which is
 * satisfied by a space, and an over-long one through any direct request.
 */
function nameProblem(error: z.ZodError): ActionResult {
  return fieldError(
    "name",
    error.issues[0]?.message ?? "A tag name is required.",
  );
}

export async function createTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  // The raw field, not `str`: that trims first and returns undefined for a
  // blank, which reaches the schema as "expected string, received undefined"
  // rather than as the sentence the person needs. The account actions read it
  // the same way, for the same reason.
  const parsed = tagName.safeParse(form.get("name"));
  if (!parsed.success) return nameProblem(parsed.error);
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
  const MISSING = "Contact or tag not found.";
  if (!contactId || !tagId) return fail(MISSING);
  const assignedOk = await prisma.$transaction(async (tx) => {
      // The lock comes first — before the visibility question, and before
      // anything else is read, for the reason `lockSubmittedTags` in
      // `actions/contacts.ts` gives about read views.
      //
      // Asked without it, the answer went stale in the gap before the write. A
      // tag on nobody is visible while locked, because a tag on nobody
      // discloses nothing; an unlocked tab assigning it to a private person in
      // that gap makes it a tag that exists only on private people, which is
      // exactly what a locked session must not be able to put on anyone. The
      // upsert does not collide with that assignment either — both take only a
      // shared lock on the tag row — so nothing else would have stopped it.
      if ((await lockTags(tx, ownerId, [tagId])) !== 1) return false;
      // The contact next, and still before anything is read. Tag then contact
      // is the order the contact-save paths take too, so the two cannot
      // deadlock against each other.
      if ((await lockContact(tx, ownerId, contactId)) !== 1) return false;
      const [contact, tag] = await Promise.all([
        tx.contact.findFirst({
          where: { id: contactId, ownerId, ...contactPrivacyWhere(scope) },
          select: { id: true },
        }),
        // The tag has to be one the lock is currently showing, not merely one
        // the account owns. This takes an id straight off a page that may have
        // been rendered before the lock closed, and a tag living only on
        // private people is exactly what must not be assignable from a locked
        // session.
        tx.tag.findFirst({
          where: { id: tagId, ...tagVisibleWhere(ownerId, scope) },
          select: { id: true },
        }),
      ]);
      if (!contact || !tag) return false;
      if (assigned)
        await tx.contactTag.upsert({
          where: { contactId_tagId: { contactId, tagId } },
          create: { contactId, tagId },
          update: {},
        });
      else await tx.contactTag.deleteMany({ where: { contactId, tagId } });
      return true;
    });
  if (!assignedOk) return fail(MISSING);
  refresh(contactId);
  return ok();
}

export async function renameTag(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();
  const id = str(form, "id");
  const parsed = tagName.safeParse(form.get("name"));
  if (!id) return fail(NOT_FOUND);
  if (!parsed.success) return nameProblem(parsed.error);
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

/**
 * Hold this account's named tags for the rest of the transaction.
 *
 * `FOR UPDATE` is a current read rather than a snapshot one, so it sees a
 * delete that committed after the transaction began, and the exclusive lock it
 * leaves means no other session can delete one of these rows — or assign it to
 * anybody, since inserting a `ContactTag` takes a shared lock on the tag it
 * references — until this transaction ends. Everything after it in the same
 * transaction is therefore reasoning about rows that cannot move underneath
 * it, which is what neither an earlier count nor a repeated one inside can
 * offer.
 *
 * Owner-scoped, so a tag belonging to another account is simply not returned
 * and the caller answers "not found" without having read anything of theirs.
 */
async function lockTags(
  tx: Prisma.TransactionClient,
  ownerId: string,
  tagIds: string[],
): Promise<number> {
  if (!tagIds.length) return 0;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Tag
    WHERE ownerId = ${ownerId} AND id IN (${Prisma.join(tagIds)})
    FOR UPDATE
  `;
  return rows.length;
}

/**
 * Hold this account's contact for the rest of the transaction.
 *
 * The other half of an assignment, and held for the same reason: a contact
 * deleted between the lookup and the write leaves the insert to meet its
 * foreign key, and how that arrives depends on the server. MariaDB 10.11
 * raises P2003, which reads as a missing row; MariaDB 11 raises 1020,
 * "record has changed since last read", which is not a Prisma error code at
 * all and escaped the action as a 500 — so translating the first was never
 * going to be enough. Holding the row means neither can happen: the delete
 * waits, and the lock simply comes back empty.
 */
async function lockContact(
  tx: Prisma.TransactionClient,
  ownerId: string,
  contactId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Contact
    WHERE ownerId = ${ownerId} AND id = ${contactId}
    FOR UPDATE
  `;
  return rows.length;
}

/**
 * Whether a tag is on anyone the closed lock is hiding.
 *
 * A tag used by one visible person and one private one stays listed while
 * locked, because the visible use is reason enough to show it. Merging or
 * deleting it from that session would move or destroy the private
 * association too — a change to a record the session cannot see, made by a
 * session that cannot see it. Both refuse instead.
 *
 * Asked inside the transaction and after `lockTags`, never before it. Asked
 * first, it answered about a moment that had already passed: an unlocked
 * session in another tab could put the tag on a private person in the gap, and
 * the merge would then carry that association to the destination and delete
 * the original — a locked session mutating a record it cannot see, which is
 * the one thing this check exists to prevent. Behind the lock no such
 * assignment can be committed, so the answer holds until the transaction ends.
 *
 * The scope is read by the caller, before the transaction opens, because it
 * reads the request's cookies and refreshes the unlock.
 */
async function touchesHiddenContacts(
  tx: Prisma.TransactionClient,
  ownerId: string,
  scope: PrivacyScope,
  tagIds: string[],
): Promise<boolean> {
  if (scope.unlocked) return false;
  // Owner-scoped on both sides. Unscoped, submitting another account's tag id
  // answered from their rows: the unlock message when their tag was on one of
  // their private contacts, "Tag not found" otherwise — a difference that is
  // itself a fact about an account this one cannot see.
  const hidden = await tx.contactTag.count({
    where: {
      tagId: { in: tagIds },
      tag: { ownerId },
      contact: { ownerId, isPrivate: true },
    },
  });
  return hidden > 0;
}

/** What a locked-namespace write settled on, so the caller can phrase it. */
type TagWriteOutcome = "done" | "missing" | "hidden";

function phrase(outcome: TagWriteOutcome, hidden: string): ActionResult {
  if (outcome === "missing") return fail(NOT_FOUND);
  if (outcome === "hidden") return fail(hidden);
  return ok();
}

/** Move every assignment to the destination, deduplicate, then remove the source. */
export async function mergeTag(
  sourceId: string,
  destinationId: string,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (sourceId === destinationId)
    return fail("Choose a different destination tag.");
  const scope = await privacyScope();
  const merged = await prisma.$transaction<TagWriteOutcome>(async (tx) => {
    // Both rows are held before anything is decided about them.
    //
    // Deleting the destination in the gap a pre-transaction check leaves did
    // not fail loudly: `createMany` with `skipDuplicates` is `INSERT IGNORE`
    // on MariaDB, and `INSERT IGNORE` demotes a foreign-key violation to a
    // warning and drops the row — so every assignment was silently discarded
    // and the source tag then deleted on top, taking the tag off people who
    // had it and reporting success. Deleting the *source* was merely noisy:
    // `delete` raised P2025, which escaped as a server error rather than the
    // sentence a tag that is no longer there deserves.
    //
    // InnoDB takes the locks in index order, which is the primary key here and
    // so the same order whichever tag is the source — two merges of the same
    // pair queue rather than deadlock.
    if ((await lockTags(tx, ownerId, [sourceId, destinationId])) !== 2)
      return "missing";
    if (await touchesHiddenContacts(tx, ownerId, scope, [sourceId, destinationId]))
      return "hidden";
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
    return "done";
  });
  if (merged !== "done")
    return phrase(merged, "Unlock to merge a tag that is on someone private.");
  refresh();
  return ok();
}

/** Deleting a tag removes only its join rows; contacts themselves are preserved. */
export async function deleteTag(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!id) return fail(NOT_FOUND);
  const scope = await privacyScope();
  const deleted = await prisma.$transaction<TagWriteOutcome>(async (tx) => {
    // The lock establishes ownership as well as holding the row, so a tag that
    // is not this account's gets the same "not found" whatever is assigned to
    // it — probing before an ownership check answered from the other account's
    // rows. It also has to come before the privacy question rather than after,
    // for the reason `touchesHiddenContacts` gives: asked outside the
    // transaction, the answer is about a moment that has passed, and an
    // unlocked tab can put this tag on a private person in the gap. The
    // cascade would then take that association with it.
    if ((await lockTags(tx, ownerId, [id])) !== 1) return "missing";
    // The assignments go with it by cascade, private ones included.
    if (await touchesHiddenContacts(tx, ownerId, scope, [id])) return "hidden";
    await tx.tag.delete({ where: { id } });
    return "done";
  });
  if (deleted !== "done")
    return phrase(deleted, "Unlock to delete a tag that is on someone private.");
  refresh();
  return ok();
}
