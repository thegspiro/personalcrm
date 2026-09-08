import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactCard } from "@/components/contacts/contact-card";
import { ContactFilters } from "@/components/contacts/contact-filters";
import { PeopleTabs } from "@/components/contacts/people-tabs";
import { Pager } from "@/components/ui/pager";
import { getUserContext } from "@/server/user/context";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { listContacts, type ContactDueStatus, type ContactSort } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";
import { listTags } from "@/server/queries/tags";
import { describePage, pageHref, pageWindow, parsePage } from "@/lib/pagination";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

const SORTS = new Set<ContactSort>(["name", "recent", "overdue", "added"]);

/**
 * How many people a page holds.
 *
 * The window the list already drew, now with a way past it rather than a
 * different size. Changing both at once would be a redesign of the list on top
 * of a fix for not being able to leave it.
 */
const PAGE_SIZE = 200;
const DUE_STATUSES = new Set<ContactDueStatus>(["actionable", "soon"]);

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, timezone } = await getUserContext();
  const cacheable = await offlineCacheable(user.id);
  const params = await searchParams;

  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const sortParam = first("sort");
  const sort = sortParam && SORTS.has(sortParam as ContactSort) ? (sortParam as ContactSort) : "name";
  const dueParam = first("due");
  const dueStatus =
    dueParam && DUE_STATUSES.has(dueParam as ContactDueStatus)
      ? (dueParam as ContactDueStatus)
      : undefined;

  const requested = parsePage(params.page);
  const window = pageWindow(requested, PAGE_SIZE);

  const [categories, tags, { items, total }] = await Promise.all([
    listTerms(user.id, "CONTACT_CATEGORY"),
    listTags(user.id),
    listContacts(user.id, {
      search: first("q"),
      categoryId: first("category"),
      tagId: first("tag"),
      scope: first("scope") === "archived" ? "archived" : "active",
      favoritesOnly: first("favorites") === "1",
      dueStatus,
      sort,
      skip: window.skip,
      take: window.take,
    }, timezone),
  ]);

  // `total` is the count behind the same where-clause the rows came from, so
  // it is privacy-filtered and owner-scoped like everything else — invariant 3.
  const page = describePage(total, requested, PAGE_SIZE);

  // A page past the end was fetched at an offset with nothing behind it, so
  // clamping only the label would leave the reader on an empty list under a
  // pager claiming there is something there. Send them to the page that
  // exists instead — which is also what makes a bookmarked `?page=6` still
  // mean something after the rows behind it are archived.
  //
  // Unconditional, including for an empty list: `?page=99` on an account with
  // nobody in it is still a URL that does not describe anything, and guarding
  // this on `total > 0` left exactly that case sitting at the wrong address.
  // It cannot loop — the clamped page always resolves to itself.
  if (page.page !== requested) {
    redirect(pageHref("/people", params, page.page));
  }

  const isFiltered = Boolean(
    first("q") || first("category") || first("tag") || first("scope") || first("favorites") || dueStatus,
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">People</h2>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "person" : "people"}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/people/new">
            <Plus />
            Add
          </Link>
        </Button>
      </div>

      <PeopleTabs active="people" />

      <ContactFilters
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        tags={tags}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={isFiltered ? "No one matches" : "No people yet"}
          description={
            isFiltered
              ? "Try a different search or clear the filters."
              : "Add the first person you want to keep track of."
          }
          action={
            isFiltered ? null : (
              <Button asChild size="sm">
                <Link href="/people/new">Add someone</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {items.map((contact) => (
              <li key={contact.id}>
                <ContactCard contact={contact} timezone={timezone} />
              </li>
            ))}
          </ul>
          <Pager info={page} pathname="/people" params={params} label="people" />
        </>
      )}
    </div>
  );
}
