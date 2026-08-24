import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactCard } from "@/components/contacts/contact-card";
import { ContactFilters } from "@/components/contacts/contact-filters";
import { getUserContext } from "@/server/user/context";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { listContacts, type ContactSort } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

const SORTS = new Set<ContactSort>(["name", "recent", "overdue", "added"]);

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

  const [categories, { items, total }] = await Promise.all([
    listTerms(user.id, "CONTACT_CATEGORY"),
    listContacts(user.id, {
      search: first("q"),
      categoryId: first("category"),
      scope: first("scope") === "archived" ? "archived" : "active",
      sort,
    }),
  ]);

  const isFiltered = Boolean(first("q") || first("category") || first("scope"));

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

      <ContactFilters categories={categories.map((c) => ({ id: c.id, label: c.label }))} />

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
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {items.map((contact) => (
            <li key={contact.id}>
              <ContactCard contact={contact} timezone={timezone} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
