"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, displayName } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { relativeDay } from "@/lib/format";
import { calendarDateInTz, type PlainDate } from "@/lib/dates";
import { SubmitButton } from "@/components/form/submit-button";
import { TaskFields } from "@/components/contacts/sections/tasks";
import { deleteTask, setTaskDone, updateTask } from "@/server/actions/details";

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

  function edit(task: TaskListItem, close: () => void) {
    return async (form: FormData) => {
      form.set("id", task.id);
      const result = await updateTask(form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save.");
        return;
      }
      toast.success("Saved");
      close();
      router.refresh();
    };
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
            onEdit={edit}
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
                onEdit={edit}
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
  onEdit,
}: {
  task: TaskListItem;
  today: PlainDate;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (task: TaskListItem, close: () => void) => (form: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const done = Boolean(task.completedAt);
  const overdue = !done && task.dueDate ? relativeDay(task.dueDate, today).includes("ago") : false;

  if (editing) {
    return (
      <li className="rounded-xl border border-accent-8 bg-card p-3">
        <form action={onEdit(task, () => setEditing(false))} className="grid gap-2.5">
          <TaskFields formId={`task-${task.id}`} task={task} />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </li>
    );
  }

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
        {task.notes ? (
          <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{task.notes}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit follow-up"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="Pencil" className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete follow-up"
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    </li>
  );
}
