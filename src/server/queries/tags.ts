import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  contactPrivacyWhere,
  privacyScope,
  type PrivacyScope,
} from "@/server/privacy/filter";

/**
 * When a tag may be seen — and therefore used — at all.
 *
 * While locked, a tag that exists only on private people is withheld: its name
 * is a fact about them. A tag on nobody reveals nothing, and hiding it would
 * leave a tag just created unusable, absent from settings and from every
 * contact form, until the lock was opened.
 *
 * One definition rather than three copies. The write paths need exactly this
 * clause, because a form loaded while unlocked keeps the ids of tags the lock
 * has since hidden, and submitting it would otherwise attach one of them to a
 * visible contact — which both mutates a private-derived association and puts
 * the hidden tag's name into `listTags` through its new visible use.
 */
export function tagVisibleWhere(
  ownerId: string,
  scope: PrivacyScope,
): Prisma.TagWhereInput {
  const visibleContact = { ownerId, ...contactPrivacyWhere(scope) };
  return {
    ownerId,
    ...(scope.unlocked
      ? {}
      : {
          OR: [
            // "On nobody" means nobody *of this account's*. An unscoped `none`
            // counted a join to another account's contact — a state the two
            // independent foreign keys permit — so one imported row made an
            // otherwise unassigned tag vanish while locked and become
            // unusable, on the strength of a person its owner cannot see.
            { contacts: { none: { contact: { ownerId } } } },
            { contacts: { some: { contact: visibleContact } } },
          ],
        }),
  };
}

/**
 * The same question as `tagVisibleWhere`, asked of rows this transaction holds.
 *
 * `tagVisibleWhere` is a filter, so it answers from the transaction's snapshot
 * and cannot see an assignment another session has written but not committed.
 * That is fine for reading — a snapshot is what a page wants — and wrong for
 * deciding whether a write may go ahead: a tag on nobody is usable while
 * locked precisely because it discloses nobody, and an unlocked tab making it
 * private-only in that gap turns the write into a disclosure.
 *
 * Locking the assignments makes the answer hold until the transaction ends.
 * Callers must already hold the tags themselves (`lockTags`), so this settles
 * only what is assigned to them.
 */
export async function lockedTagsUsable(
  tx: Prisma.TransactionClient,
  ownerId: string,
  scope: PrivacyScope,
  tagIds: string[],
): Promise<boolean> {
  if (scope.unlocked || !tagIds.length) return true;
  const rows = await tx.$queryRaw<Array<{ tagId: string; isPrivate: number | boolean }>>`
    SELECT ct.tagId, c.isPrivate FROM ContactTag ct
    JOIN Contact c ON c.ownerId = ct.ownerId AND c.id = ct.contactId
    WHERE ct.ownerId = ${ownerId} AND ct.tagId IN (${Prisma.join(tagIds)})
    FOR UPDATE
  `;
  // On nobody discloses nobody, and one visible use is reason enough to show
  // it; a tag left only on people the lock hides is the one that must not be
  // handed out.
  return tagIds.every((tagId) => {
    const uses = rows.filter((row) => row.tagId === tagId);
    return uses.length === 0 || uses.some((row) => !row.isPrivate);
  });
}

/** Tags visible in the current privacy scope, with non-disclosing usage counts. */
export async function listTags(ownerId: string) {
  const scope = await privacyScope();
  const visibleContact = { ownerId, ...contactPrivacyWhere(scope) };
  const tags = await prisma.tag.findMany({
    where: tagVisibleWhere(ownerId, scope),
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      _count: { select: { contacts: { where: { contact: visibleContact } } } },
    },
    orderBy: { name: "asc" },
  });
  return tags.map(({ _count, ...tag }) => ({
    ...tag,
    usageCount: _count.contacts,
  }));
}
