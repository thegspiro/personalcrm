"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField } from "@/components/form/date-field";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { formatPartialDate } from "@/lib/date-precision";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import { createTask, deleteTask, setTaskDone, updateTask } from "@/server/actions/details";

export interface TaskItem {
  id: string;
  title: string;
  notes: string | null;
  dueDate: PlainDate | null;
  completedAt: Date | null;
  priority: "LOW" | "NORMAL" | "HIGH";
}

/** Adding a manual task and correcting one. Shared with the /tasks page. */
export function TaskFields({ formId, task }: { formId: string; task?: TaskItem }) {
  return (
    <>
      <Field label="What do you need to do?" htmlFor={`${formId}-title`}>
        <Input
          id={`${formId}-title`}
          name="title"
          required
          defaultValue={task?.title ?? ""}
          placeholder="Send the bakery recommendation"
        />
      </Field>
      <DateField
        name="dueDate"
        idPrefix={`${formId}-dueDate`}
        label="Due"
        allowPrecision={false}
        presets={["today"]}
        defaultValue={task?.dueDate ? plainDateKey(task.dueDate) : undefined}
      />
      <Field label="Priority" htmlFor={`${formId}-priority`}>
        <select
          id={`${formId}-priority`}
          name="priority"
          defaultValue={task?.priority ?? "NORMAL"}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="LOW">Low</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
        </select>
      </Field>
      <Field label="Notes" htmlFor={`${formId}-notes`}>
        <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={task?.notes ?? ""} />
      </Field>
    </>
  );
}

export function TasksSection({ contactId, tasks }: { contactId: string; tasks: TaskItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const open = tasks.filter((task) => !task.completedAt);

  return (
    <SectionCard
      id="tasks"
      title="Tasks"
      icon="CircleCheck"
      count={open.length}
      addLabel="Add a task"
      form={(close) => (
        <form action={add(createTask, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <TaskFields formId="task-new" />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {open.length === 0 ? (
        <SectionEmpty>Nothing outstanding.</SectionEmpty>
      ) : (
        open.map((task) => (
          <SectionRow
            key={task.id}
            onDelete={() => void run(() => deleteTask(task.id), "Removed")}
            deleteLabel="Delete task"
            editLabel="Edit task"
            editForm={(close) => (
              <form action={add(updateTask, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={task.id} />
                <TaskFields formId={`task-${task.id}`} task={task} />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={false}
                onCheckedChange={() => void run(() => setTaskDone(task.id, true), "Done")}
                aria-label="Mark done"
                className="mt-0.5"
              />
              <div className="min-w-0">
                <p className="text-sm">{task.title}</p>
                {task.dueDate ? (
                  <p className="text-xs text-muted-foreground">
                    Due {formatPartialDate(task.dueDate, "DAY", { short: true })}
                  </p>
                ) : null}
              </div>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
