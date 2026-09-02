import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { TaskList } from "@/components/lists/task-list";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import { applyCap } from "@/lib/list-cap";
import { plainDateFromDb } from "@/lib/dates";
import {
  privacyScope,
  viaOptionalContactPrivacyWhere,
} from "@/server/privacy/filter";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { getOverdueContacts } from "@/server/queries/dashboard";
import Link from "next/link";
import { displayName } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

/** One more than this is fetched, so the page can tell a full list from a cut one. */
const CAP = 200;

export default async function TasksPage() {
  const { user, timezone } = await getUserContext();
  const scope = await privacyScope();

  const [peopleRows, rows, cacheable] = await Promise.all([
    getOverdueContacts(user.id, timezone, CAP + 1),
    prisma.task.findMany({
      where: {
        ownerId: user.id,
        ...viaOptionalContactPrivacyWhere(scope),
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [
        { completedAt: "asc" },
        { dueDate: { sort: "asc", nulls: "last" } },
      ],
      take: CAP + 1,
    }),
    offlineCacheable(user.id),
  ]);

  const { items: tasks, truncated } = applyCap(rows, CAP);
  const { items: people, truncated: peopleTruncated } = applyCap(
    peopleRows,
    CAP,
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Follow-ups</h2>
        <p className="text-xs text-muted-foreground">
          One place for the people you mean to contact and the things you said
          you&apos;d do.
        </p>
      </div>
      <section
        id="people-to-contact"
        aria-labelledby="people-to-contact-heading"
        className="grid gap-3 scroll-mt-4"
      >
        <div>
          <h3 id="people-to-contact-heading" className="font-semibold">
            People to contact
          </h3>
          <p className="text-xs text-muted-foreground">
            People whose keep-in-touch cadence is due.
          </p>
        </div>
        {people.length === 0 ? (
          <EmptyState
            icon={<Icon name="Users" />}
            title="Nobody is due"
            description="People will appear here when their keep-in-touch cadence comes due."
          />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {people.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/people/${person.id}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover:bg-muted/60"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {displayName(person)}
                  </span>
                  <span className="shrink-0 text-xs text-destructive">
                    {person.daysOverdue === 0
                      ? "Due today"
                      : `${person.daysOverdue}d overdue`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {peopleTruncated ? (
          <ListCapNotice
            shown={people.length}
            noun="people"
            hint="Contact someone to see the next people in the queue."
          />
        ) : null}
      </section>
      <section
        id="things-to-do"
        aria-labelledby="things-to-do-heading"
        className="grid gap-3 scroll-mt-4"
      >
        <div>
          <h3 id="things-to-do-heading" className="font-semibold">
            Things to do
          </h3>
          <p className="text-xs text-muted-foreground">
            Manual tasks and commitments, with or without a person.
          </p>
        </div>
        <TaskList
          tasks={tasks.map((task) => ({
            id: task.id,
            title: task.title,
            notes: task.notes,
            dueDate: task.dueDate ? plainDateFromDb(task.dueDate) : null,
            completedAt: task.completedAt,
            priority: task.priority,
            contact: task.contact,
          }))}
          timezone={timezone}
        />
        {truncated ? (
          <ListCapNotice
            shown={tasks.length}
            noun="tasks"
            hint="Complete or clear some to see the older ones."
          />
        ) : null}
      </section>
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
