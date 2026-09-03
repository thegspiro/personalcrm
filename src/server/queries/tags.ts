import "server-only";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";

/** Tags visible in the current privacy scope, with non-disclosing usage counts. */
export async function listTags(ownerId: string) {
  const scope = await privacyScope();
  const visibleContact = { ownerId, ...contactPrivacyWhere(scope) };
  const tags = await prisma.tag.findMany({
    where: {
      ownerId,
      // While locked, do not reveal a tag that exists only on private people.
      // A tag on nobody reveals nothing, and hiding it would leave a tag just
      // created unusable — absent from settings and from every contact form —
      // until the lock was opened.
      ...(scope.unlocked
        ? {}
        : {
            OR: [
              { contacts: { none: {} } },
              { contacts: { some: { contact: visibleContact } } },
            ],
          }),
    },
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
