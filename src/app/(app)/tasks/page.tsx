import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { TaskList } from "@/components/lists/task-list";
import { plainDateFromDb } from "@/lib/dates";
import { privacyScope, viaContactPrivacyWhere } from "@/server/privacy/filter";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user, timezone } = await getUserContext();
  const scope = await privacyScope();

  const [tasks, cacheable] = await Promise.all([
    prisma.task.findMany({
      where: {
        ownerId: user.id,
        OR: [{ contactId: null }, viaContactPrivacyWhere(scope)],
      },
      include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ completedAt: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      take: 200,
    }),
    offlineCacheable(user.id),
  ]);

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
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
