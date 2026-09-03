import "server-only";
import type { Prisma } from "@prisma/client";
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
            { contacts: { none: {} } },
            { contacts: { some: { contact: visibleContact } } },
          ],
        }),
  };
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
