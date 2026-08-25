import { getUserContext } from "@/server/user/context";
import { normalizeDashboardLayout, WIDGET_REGISTRY, widgetSetting } from "@/lib/dashboard";
import { prisma } from "@/server/db/client";
import { listContactOptions } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";
import { getDatingSummary } from "@/server/queries/dating";
import { canSeeDating } from "@/server/privacy/filter";
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
import { fieldsFor } from "@/server/queries/custom-fields";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { SetupChecklist } from "@/components/onboarding/setup-checklist";
import { needsSetupChecklist } from "@/lib/setup-checklist";
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
  const { user, prefs, timezone } = await getUserContext();

  // The dating widget is gated the same way the module is: hidden outright, or
  // withheld until the privacy lock is opened.
  const showDating = await canSeeDating(prefs.hideDating);
  // The dating widget is the most sensitive thing on this page, so its
  // presence rules out keeping a copy regardless of everything else.
  const cacheable = !showDating && (await offlineCacheable(user.id));

  // Two counts rather than a stored flag, so a step skipped in the wizard and
  // then done anyway ticks itself off.
  const [contactCount, interactionCount] = await Promise.all([
    prisma.contact.count({ where: { ownerId: user.id } }),
    prisma.interaction.count({ where: { ownerId: user.id } }),
  ]);
  const checklist = {
    hasPeople: contactCount > 0,
    hasInteractions: interactionCount > 0,
    hasInstalled: Boolean(prefs.pwaInstalledAt),
  };

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
    datingSummary,
    interactionFields,
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
    enabled.has("dating-pipeline") && showDating ? getDatingSummary(user.id) : null,
    enabled.has("quick-add") ? fieldsFor(user.id, "INTERACTION", null) : [],
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
    "quick-add": (
      <QuickAddWidget
        contacts={contacts}
        types={interactionTypes}
        customFields={interactionFields}
      />
    ),
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
    "dating-pipeline": datingSummary ? (
      <DatingPipelineWidget data={datingSummary} timezone={timezone} />
    ) : null,
    stats: stats ? <StatsWidget stats={stats} /> : null,
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {cacheable ? <CacheThisPage /> : null}
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

      {needsSetupChecklist(checklist) ? <SetupChecklist {...checklist} /> : null}

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
