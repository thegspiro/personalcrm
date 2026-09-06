import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { listAssociateGroups } from "@/server/queries/associates";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import { AssociateList } from "@/components/lists/associate-list";
import { PeopleTabs } from "@/components/contacts/people-tabs";

export const metadata: Metadata = { title: "Their people" };
export const dynamic = "force-dynamic";

/** One more than this is fetched, so the page can tell a full list from a cut one. */
const CAP = 300;

/**
 * Everyone your people talk about, in one place.
 *
 * A static segment beside `/people/[id]`, which the App Router resolves in its
 * favour — and contact ids are cuids, so no real person could be shadowed by
 * it in any case.
 */
export default async function TheirPeoplePage() {
  const { user } = await getUserContext();
  const [{ items: groups, truncated }, cacheable] = await Promise.all([
    listAssociateGroups(user.id, CAP),
    offlineCacheable(user.id),
  ]);

  const total = groups.reduce((count, group) => count + group.entries.length, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Their people</h2>
        <p className="text-xs text-muted-foreground">
          The people your people talk about, so you can ask after them.
        </p>
      </div>

      <PeopleTabs active="friends" />

      {groups.length === 0 ? (
        <EmptyState
          icon={<Icon name="UsersRound" />}
          title="No one noted yet"
          description="Add them from a person's page as they come up in conversation."
        />
      ) : (
        <>
          <AssociateList groups={groups} />
          {truncated ? (
            <ListCapNotice
              shown={total}
              noun="entries"
              hint="Open a person's page to see the rest of theirs."
            />
          ) : null}
        </>
      )}
    </div>
  );
}
