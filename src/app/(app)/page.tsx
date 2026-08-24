import { getUserContext } from "@/server/user/context";
import { normalizeDashboardLayout, WIDGET_REGISTRY, widgetSetting } from "@/lib/dashboard";
import { prisma } from "@/server/db/client";
import { listContactOptions } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";
import {
  getOpenIdeas,
  getOpenTasks,
  getOverdueContacts,
  getRecentInteractions,
  getStats,
  getUpcomingDates,
  getUpcomingInteractions,
} from "@/server/queries/dashboard";
import { QuickAddWidget } from "@/components/dashboard/quick-add";
import {
  DatingPipelineWidget,
  IdeasWidget,
  OverdueWidget,
  RecentWidget,
  StatsWidget,
  TasksWidget,
  UpcomingDatesWidget,
  UpcomingInteractionsWidget,
} from "@/components/dashboard/widgets";
import { plainDateFromDb } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, timezone } = await getUserContext();

  const layoutRow = await prisma.dashboardLayout.findUnique({ where: { userId: user.id } });
  const layout = normalizeDashboardLayout(layoutRow?.widgets).filter((entry) => entry.enabled);
  const enabled = new Set(layout.map((entry) => entry.id));

  const settingFor = (id: string, key: string, fallback: number) => {
    const entry = layout.find((item) => item.id === id);
    return entry ? widgetSetting(entry, key, fallback) : fallback;
  };

  // Only fetch what the layout actually renders.
  const [
    contacts,
    interactionTypes,
    overdue,
    upcomingDates,
    recent,
    upcomingInteractions,
    tasks,
    ideas,
    stats,
  ] = await Promise.all([
    enabled.has("quick-add") ? listContactOptions(user.id) : [],
    enabled.has("quick-add") ? listTerms(user.id, "INTERACTION_TYPE") : [],
    enabled.has("overdue")
      ? getOverdueContacts(user.id, timezone, settingFor("overdue", "limit", 8))
      : [],
    enabled.has("upcoming-dates")
      ? getUpcomingDates(
          user.id,
          timezone,
          settingFor("upcoming-dates", "windowDays", 45),
          settingFor("upcoming-dates", "limit", 8),
        )
      : [],
    enabled.has("recent-interactions")
      ? getRecentInteractions(user.id, settingFor("recent-interactions", "limit", 8))
      : [],
    enabled.has("recent-interactions") ? getUpcomingInteractions(user.id) : [],
    enabled.has("open-tasks") ? getOpenTasks(user.id, settingFor("open-tasks", "limit", 8)) : [],
    enabled.has("idea-bank") ? getOpenIdeas(user.id, settingFor("idea-bank", "limit", 6)) : [],
    enabled.has("stats") ? getStats(user.id, timezone) : null,
  ]);

  const mapInteractions = (rows: typeof recent) =>
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      occurredAt: row.occurredAt,
      type: row.type ? { label: row.type.label, icon: row.type.icon, color: row.type.color } : null,
      contacts: row.participants.map((p) => p.contact),
    }));

  const widgets: Record<string, React.ReactNode> = {
    "quick-add": <QuickAddWidget contacts={contacts} types={interactionTypes} />,
    overdue: <OverdueWidget contacts={overdue} />,
    "upcoming-dates": <UpcomingDatesWidget dates={upcomingDates} />,
    "recent-interactions": (
      <>
        <UpcomingInteractionsWidget
          interactions={mapInteractions(upcomingInteractions)}
          timezone={timezone}
        />
        <RecentWidget interactions={mapInteractions(recent)} timezone={timezone} />
      </>
    ),
    "open-tasks": (
      <TasksWidget
        tasks={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: task.dueDate ? plainDateFromDb(task.dueDate) : null,
          contact: task.contact,
        }))}
      />
    ),
    "idea-bank": (
      <IdeasWidget
        ideas={ideas.map((idea) => ({
          id: idea.id,
          content: idea.content,
          contact: idea.contact,
        }))}
      />
    ),
    "dating-pipeline": <DatingPipelineWidget />,
    stats: stats ? <StatsWidget stats={stats} /> : null,
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Hi {user.name.split(" ")[0]}
        </h2>
        <p className="text-xs text-muted-foreground">
          {overdue.length > 0
            ? `${overdue.length} ${overdue.length === 1 ? "person" : "people"} to reach out to.`
            : "You're on top of things."}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {layout.map((entry) => {
          const node = widgets[entry.id];
          if (!node) return null;
          const definition = WIDGET_REGISTRY[entry.id];
          return (
            <div key={entry.id} className={definition?.wide ? "lg:col-span-2" : undefined}>
              {node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
