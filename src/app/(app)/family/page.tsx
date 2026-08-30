import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { getFamilyOverview } from "@/server/queries/family";
import { listTerms } from "@/server/taxonomy/queries";
import { privacyScope, contactPrivacyWhere } from "@/server/privacy/filter";
import { familyMeta } from "@/lib/family";
import { displayName } from "@/lib/utils";
import { FamilyTree } from "@/components/family/family-tree";
import { Households, FamilyEmpty } from "@/components/family/households";
import { SuggestionList } from "@/components/family/suggestions";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Family" };
export const dynamic = "force-dynamic";

export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ anchor?: string }>;
}) {
  const { user } = await getUserContext();
  const { anchor } = await searchParams;
  const scope = await privacyScope();

  const [overview, relationshipTerms, contacts, cacheable] = await Promise.all([
    getFamilyOverview(user.id, anchor),
    listTerms(user.id, "RELATIONSHIP_TYPE"),
    prisma.contact.findMany({
      where: { ownerId: user.id, isArchived: false, ...contactPrivacyWhere(scope) },
      select: { id: true, firstName: true, lastName: true, nickname: true },
      orderBy: [{ lastInteractionAt: "desc" }, { firstName: "asc" }],
      take: 500,
    }),
    offlineCacheable(user.id),
  ]);

  const familyTypes = relationshipTerms
    .filter((term) => familyMeta(term) !== null)
    .map((term) => ({ id: term.id, label: term.label, icon: term.icon, color: term.color }));

  const bands = overview.bands.map((band) => ({
    generation: band.generation,
    people: band.people.map((entry) => ({
      id: entry.person.id,
      isAnchor: entry.person.id === overview.anchor?.id,
      firstName: entry.person.firstName,
      lastName: entry.person.lastName,
      nickname: entry.person.nickname,
      isArchived: entry.person.isArchived,
      terms: entry.links.map((link) => link.term),
      householdNames: entry.householdNames,
    })),
  }));

  const suggestions = overview.suggestions.map((suggestion) => ({
    subjectId: suggestion.subjectId,
    personId: suggestion.personId,
    subjectName: displayName(suggestion.subject),
    personName: displayName(suggestion.person),
    reason: suggestion.reason,
    termId: suggestion.termId,
    termLabel: suggestion.termLabel,
  }));

  const hasFamily = bands.some((band) => band.people.length > 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Family</h2>
        <p className="text-xs text-muted-foreground">
          Who belongs to whom — immediate, extended, in-laws and the family you chose.
        </p>
      </div>

      <SuggestionList suggestions={suggestions} types={familyTypes} showSubject />

      <Households households={overview.households} contacts={contacts} />

      {hasFamily ? (
        <FamilyTree
          bands={bands}
          anchorName={overview.anchor ? displayName(overview.anchor) : null}
          anchorOptions={bands
            .flatMap((band) => band.people)
            .map((person) => ({ id: person.id, name: displayName(person) }))
            .sort((a, b) => a.name.localeCompare(b.name))}
        />
      ) : (
        <FamilyEmpty />
      )}
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
