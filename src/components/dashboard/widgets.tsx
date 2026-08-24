import Link from "next/link";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPartialDate } from "@/lib/date-precision";
import { relativeInstant, termColorClasses } from "@/lib/format";
import type { PlainDate } from "@/lib/dates";
import type { DashboardStats, OverdueContact, UpcomingDate } from "@/server/queries/dashboard";

export function WidgetShell({
  title,
  icon,
  href,
  hrefLabel,
  testId,
  children,
  className,
}: {
  title: string;
  icon: string;
  href?: string;
  hrefLabel?: string;
  testId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className} data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon name={icon} className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {href ? (
          <Link href={href} className="shrink-0 text-xs font-medium text-accent-11 hover:underline">
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-xs text-muted-foreground">{children}</p>;
}

export function OverdueWidget({ contacts }: { contacts: OverdueContact[] }) {
  return (
    <WidgetShell title="Time to reach out" icon="BellRing" href="/people?sort=overdue" testId="widget-overdue">
      {contacts.length === 0 ? (
        <Empty>Nobody&apos;s overdue. Nice.</Empty>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Link
                href={`/people/${contact.id}`}
                className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted"
              >
                <Avatar className="size-8">
                  <AvatarFallback>
                    {initialsOf(contact.firstName, contact.lastName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">{displayName(contact)}</span>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {contact.daysOverdue === 0 ? "today" : `${contact.daysOverdue}d`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export function UpcomingDatesWidget({ dates }: { dates: UpcomingDate[] }) {
  return (
    <WidgetShell title="Coming up" icon="CalendarDays" testId="widget-upcoming-dates">
      {dates.length === 0 ? (
        <Empty>Nothing in the next few weeks.</Empty>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {dates.map((item) => (
            <li key={item.id}>
              <Link
                href={`/people/${item.contact.id}`}
                className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    termColorClasses(item.term?.color),
                  )}
                >
                  <Icon name={item.term?.icon ?? "CalendarDays"} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {displayName(item.contact)}
                    {item.turning !== null ? (
                      <span className="text-muted-foreground"> turns {item.turning}</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.label} · {formatPartialDate(item.occursOn, "MONTH_DAY", { short: true })}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                  {item.daysAway === 0 ? "today" : `${item.daysAway}d`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export interface RecentInteraction {
  id: string;
  title: string | null;
  occurredAt: Date;
  type: { label: string; icon: string | null; color: string | null } | null;
  contacts: Array<{ id: string; firstName: string; lastName: string | null }>;
}

export function RecentWidget({
  interactions,
  timezone,
  title = "Recent activity",
  icon = "History",
}: {
  interactions: RecentInteraction[];
  timezone: string;
  title?: string;
  icon?: string;
}) {
  return (
    <WidgetShell title={title} icon={icon} href="/timeline">
      {interactions.length === 0 ? (
        <Empty>Nothing logged yet.</Empty>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {interactions.map((interaction) => (
            <li key={interaction.id}>
              <Link
                href={
                  interaction.contacts[0] ? `/people/${interaction.contacts[0].id}` : "/timeline"
                }
                className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    termColorClasses(interaction.type?.color),
                  )}
                >
                  <Icon name={interaction.type?.icon ?? "MessageSquare"} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {interaction.title ?? interaction.type?.label ?? "Interaction"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {interaction.contacts.map((c) => displayName(c)).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                  {relativeInstant(interaction.occurredAt, timezone)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export interface TaskRow {
  id: string;
  title: string;
  dueDate: PlainDate | null;
  contact: { id: string; firstName: string; lastName: string | null } | null;
}

export function TasksWidget({ tasks }: { tasks: TaskRow[] }) {
  return (
    <WidgetShell title="Follow-ups" icon="CircleCheck" href="/tasks">
      {tasks.length === 0 ? (
        <Empty>Nothing outstanding.</Empty>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 items-center gap-2 px-1 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{task.title}</span>
                {task.contact ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {displayName(task.contact)}
                  </span>
                ) : null}
              </span>
              {task.dueDate ? (
                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                  {formatPartialDate(task.dueDate, "MONTH_DAY", { short: true })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export interface IdeaRow {
  id: string;
  content: string;
  contact: { id: string; firstName: string; lastName: string | null } | null;
}

export function IdeasWidget({ ideas }: { ideas: IdeaRow[] }) {
  return (
    <WidgetShell title="Bring this up" icon="Lightbulb" href="/ideas">
      {ideas.length === 0 ? (
        <Empty>No ideas saved.</Empty>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {ideas.map((idea) => (
            <li key={idea.id} className="px-1 py-1">
              <p className="text-sm">{idea.content}</p>
              {idea.contact ? (
                <Link
                  href={`/people/${idea.contact.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {displayName(idea.contact)}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export function StatsWidget({ stats }: { stats: DashboardStats }) {
  const tiles = [
    { label: "People", value: stats.people },
    { label: "Logged this month", value: stats.interactionsThisMonth },
    { label: "Overdue", value: stats.overdue },
    { label: "Open follow-ups", value: stats.openTasks },
  ];

  return (
    <WidgetShell title="At a glance" icon="ChartNoAxesColumn" className="lg:col-span-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg bg-muted/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{tile.value}</dd>
          </div>
        ))}
      </dl>
    </WidgetShell>
  );
}

export function DatingPipelineWidget() {
  return (
    <WidgetShell title="Dating pipeline" icon="Heart" className="lg:col-span-2">
      <Empty>The dating module lands in the next phase.</Empty>
    </WidgetShell>
  );
}

export function UpcomingInteractionsWidget({
  interactions,
  timezone,
}: {
  interactions: RecentInteraction[];
  timezone: string;
}) {
  if (interactions.length === 0) return null;
  return (
    <WidgetShell title="Planned" icon="CalendarClock">
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {interactions.map((interaction) => (
          <li key={interaction.id} className="flex min-w-0 items-center gap-2 px-1 py-1">
            <Badge variant="outline">Upcoming</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {interaction.title ?? interaction.type?.label ?? "Interaction"}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
              {relativeInstant(interaction.occurredAt, timezone)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}
