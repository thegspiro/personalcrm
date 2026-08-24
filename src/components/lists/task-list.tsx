"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, displayName } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { relativeDay } from "@/lib/format";
import { calendarDateInTz, type PlainDate } from "@/lib/dates";
import { deleteTask, setTaskDone } from "@/server/actions/details";

export interface TaskListItem {
  id: string;
  title: string;
  notes: string | null;
  dueDate: PlainDate | null;
  completedAt: Date | null;
  priority: "LOW" | "NORMAL" | "HIGH";
  contact: { id: string; firstName: string; lastName: string | null } | null;
}

export function TaskList({ tasks, timezone }: { tasks: TaskListItem[]; timezone: string }) {
  const router = useRouter();
  const today = calendarDateInTz(new Date(), timezone);

  const open = tasks.filter((task) => !task.completedAt);
  const done = tasks.filter((task) => task.completedAt);

  async function toggle(task: TaskListItem) {
    const result = await setTaskDone(task.id, !task.completedAt);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update.");
      return;
    }
    router.refresh();
  }

  async function remove(task: TaskListItem) {
    const result = await deleteTask(task.id);
    if (!result.ok) {
      toast.error(result.error ?? "Could not delete.");
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="CircleCheck" />}
        title="Nothing to follow up on"
        description="Add follow-ups from a person's page."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            onToggle={() => void toggle(task)}
            onDelete={() => void remove(task)}
          />
        ))}
      </ul>

      {done.length > 0 ? (
        <details className="grid gap-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Done ({done.length})
          </summary>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-2">
            {done.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onToggle={() => void toggle(task)}
                onDelete={() => void remove(task)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  today,
  onToggle,
  onDelete,
}: {
  task: TaskListItem;
  today: PlainDate;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = Boolean(task.completedAt);
  const overdue = !done && task.dueDate ? relativeDay(task.dueDate, today).includes("ago") : false;

  return (
    <li className="group flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <Checkbox checked={done} onCheckedChange={onToggle} aria-label="Toggle done" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", done && "text-muted-foreground line-through")}>{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {task.contact ? (
            <Link href={`/people/${task.contact.id}`} className="hover:text-foreground">
              {displayName(task.contact)}
            </Link>
          ) : null}
          {task.dueDate ? (
            <span className={cn(overdue && "font-medium text-destructive")}>
              {relativeDay(task.dueDate, today)}
            </span>
          ) : null}
          {task.priority === "HIGH" ? <span className="text-[var(--warning)]">High</span> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete follow-up"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <span aria-hidden>×</span>
      </button>
    </li>
  );
}
