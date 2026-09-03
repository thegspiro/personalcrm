import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { getFamilyOverview } from "@/server/queries/family";
import { CONTACT_OPTIONS_CAP, listContactOptions } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";
import { familyMeta, groupFamilyBand } from "@/lib/family";
import { applyCap } from "@/lib/list-cap";
import { displayName } from "@/lib/utils";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import { FamilyTree } from "@/components/family/family-tree";
import { Households, FamilyEmpty } from "@/components/family/households";
import { AddRelative } from "@/components/family/add-relative";
import { SuggestionList } from "@/components/family/suggestions";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Family" };
export const dynamic = "force-dynamic";

/**
 * How many suggestions the page draws.
 *
 * The suggester is quadratic in the shape of the family rather than its size —
 * one well-recorded generation produces cousins, in-laws and nieces for
 * everybody — so an uncapped list can run to hundreds of cards on an account
 * with a few dozen people in it. Capped and sorted, with the count said out
 * loud, beats a page that scrolls for a minute.
 */
const SUGGESTION_CAP = 24;

/**
 * A band member as the tree actually draws them.
 *
 * `tier` and `via` decide which group someone lands in and are of no use once
 * that is settled, so they stop at the server rather than riding along in the
 * payload the browser receives — and, on a cacheable page, is written to disk.
 */
function forDisplay<T extends { tier: unknown; via: unknown }>(person: T) {
  const { tier: _tier, via: _via, ...rest } = person;
  void _tier;
  void _via;
  return rest;
}

export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ anchor?: string }>;
}) {
  const { user } = await getUserContext();
  const { anchor } = await searchParams;

  const [overview, relationshipTerms, contactRows, cacheable] = await Promise.all([
    getFamilyOverview(user.id, anchor),
    listTerms(user.id, "RELATIONSHIP_TYPE"),
    listContactOptions(user.id, CONTACT_OPTIONS_CAP + 1),
    offlineCacheable(user.id),
  ]);

  // The picker fetched one row past its cap purely so the page can tell a full
  // list from a cut-off one; that extra row is trimmed here and never rendered.
  const { items: contactList, truncated: contactsTruncated } = applyCap(
    contactRows,
    CONTACT_OPTIONS_CAP,
  );
  const contacts = contactList.map((contact) => ({
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    nickname: contact.nickname,
  }));

  const familyTypes = relationshipTerms
    .filter((term) => familyMeta(term) !== null)
    .map((term) => ({ id: term.id, label: term.label, icon: term.icon, color: term.color }));

  const anchorId = overview.anchor?.id ?? null;
  const anchorName = overview.anchor ? displayName(overview.anchor) : null;

  const banded = overview.bands.map((band) => ({
    generation: band.generation,
    people: band.people.map((entry) => ({
      id: entry.person.id,
      firstName: entry.person.firstName,
      lastName: entry.person.lastName,
      nickname: entry.person.nickname,
      avatarPath: entry.person.avatarPath,
      isArchived: entry.person.isArchived,
      terms: entry.links.map((link) => link.term),
      householdNames: entry.householdNames,
      tier: entry.tier,
      via: entry.via,
    })),
  }));

  // Grouped here rather than in the tree component, which is a client one.
  // `groupFamilyBand` orders its "Through …" groups with `localeCompare`, and
  // the server's default locale need not match the browser's: the same names
  // can order one way in the server-rendered HTML and another during
  // hydration, which React resolves by throwing the subtree away. Sorting once,
  // on the server, removes the question — and keeps the grouping off the wire.
  const bands = banded.map((band) => {
    // The anchor roots its own band rather than joining a group inside it:
    // there is no link from someone to themselves for a tier to come from.
    const anchor = band.people.find((person) => person.id === anchorId) ?? null;
    const groups = groupFamilyBand(
      band.people.filter((person) => person.id !== anchorId),
      anchorName,
    );
    return {
      generation: band.generation,
      count: band.people.length,
      anchor: anchor ? forDisplay(anchor) : null,
      groups: groups.map((group) => ({
        key: group.key,
        label: group.label,
        people: group.people.map(forDisplay),
      })),
    };
  });

  // Mapped down rather than passed through: `FamilyPerson` also carries
  // `isPrivate`, `lastInteractionAt` and `nextTouchAt`, and everything handed
  // to a client component is serialised into the payload the browser receives
  // and the service worker may write to disk. None of it is drawn here.
  const households = overview.households.map((household) => ({
    id: household.id,
    name: household.name,
    notes: household.notes,
    members: household.members.map((member) => ({
      person: {
        id: member.person.id,
        firstName: member.person.firstName,
        lastName: member.person.lastName,
        nickname: member.person.nickname,
        avatarPath: member.person.avatarPath,
      },
      role: member.role,
    })),
  }));

  const { items: suggestionCards, truncated: suggestionsTruncated } = applyCap(
    overview.suggestions,
    SUGGESTION_CAP,
  );
  const suggestions = suggestionCards.map((suggestion) => ({
    subjectId: suggestion.subjectId,
    personId: suggestion.personId,
    subjectName: displayName(suggestion.subject),
    personName: displayName(suggestion.person),
    reason: suggestion.reason,
    termId: suggestion.termId,
    termLabel: suggestion.termLabel,
  }));

  const hasFamily = banded.some((band) => band.people.length > 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Family</h2>
        <p className="text-xs text-muted-foreground">
          Who belongs to whom — immediate, extended, in-laws and the family you chose.
        </p>
      </div>

      <AddRelative contacts={contacts} familyTypes={familyTypes} />

      <SuggestionList
        suggestions={suggestions}
        types={familyTypes}
        showSubject
        footer={
          suggestionsTruncated ? (
            <ListCapNotice
              shown={suggestions.length}
              noun="suggestions"
              hint="Add or dismiss some to see the rest."
            />
          ) : null
        }
      />

      <Households households={households} contacts={contacts} />

      {hasFamily ? (
        <FamilyTree
          bands={bands}
          anchorId={anchorId}
          anchorName={anchorName}
          anchorOptions={banded
            .flatMap((band) => band.people)
            .map((person) => ({ id: person.id, name: displayName(person) }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))}
        />
      ) : (
        <FamilyEmpty />
      )}

      {contactsTruncated ? (
        <ListCapNotice
          shown={contacts.length}
          noun="people in the pickers"
          hint="The least recently contacted drop off first."
        />
      ) : null}

      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
