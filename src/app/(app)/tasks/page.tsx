import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { TaskList } from "@/components/lists/task-list";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import { applyCap } from "@/lib/list-cap";
import { plainDateFromDb } from "@/lib/dates";
import { privacyScope, viaOptionalContactPrivacyWhere } from "@/server/privacy/filter";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

/** One more than this is fetched, so the page can tell a full list from a cut one. */
const CAP = 200;

export default async function TasksPage() {
  const { user, timezone } = await getUserContext();
  const scope = await privacyScope();

  const [rows, cacheable] = await Promise.all([
    prisma.task.findMany({
      where: {
        ownerId: user.id,
        ...viaOptionalContactPrivacyWhere(scope),
      },
      include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ completedAt: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      take: CAP + 1,
    }),
    offlineCacheable(user.id),
  ]);

  const { items: tasks, truncated } = applyCap(rows, CAP);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Follow-ups</h2>
        <p className="text-xs text-muted-foreground">Things you said you&apos;d do.</p>
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
          noun="follow-ups"
          hint="Complete or clear some to see the older ones."
        />
      ) : null}
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
