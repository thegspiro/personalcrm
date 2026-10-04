import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import {
  getAssociate,
  linkableContacts,
  mergeCandidates,
} from "@/server/queries/associates";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { AssociateDetail } from "@/components/associates/associate-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { user } = await getUserContext();
  const { id } = await params;
  const associate = await getAssociate(user.id, id);
  return { title: associate ? associate.name : "Their people" };
}

/**
 * One person in your people's lives, everything known about them in one place.
 *
 * Nested under `/people/friends` rather than beside `/people/[id]`: this is not
 * a contact, and the URL should not suggest it is one. The static `friends`
 * segment wins over `/people/[id]`, and contact ids are cuids, so no real
 * person can be shadowed by it.
 */
export default async function AssociatePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getUserContext();
  const { id } = await params;

  const associate = await getAssociate(user.id, id);
  if (!associate) notFound();

  const [terms, contacts, candidates, accountCacheable] = await Promise.all([
    listTermsByKind(user.id, ["RELATIONSHIP_TYPE"]),
    associate.isPromoted
      ? Promise.resolve({ items: [], truncated: false })
      : linkableContacts(user.id, id),
    mergeCandidates(user.id, {
      id,
      promotedContactId: associate.promoted?.id ?? null,
    }),
    offlineCacheable(user.id),
  ]);
  // The entry's own marker decides it as well, as a person's does on theirs.
  const cacheable = !associate.isPrivate && accountCacheable;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
      <AssociateDetail
        associate={associate}
        linkableContacts={contacts.items}
        candidates={candidates.items}
        types={terms.RELATIONSHIP_TYPE ?? []}
      />
    </div>
  );
}
