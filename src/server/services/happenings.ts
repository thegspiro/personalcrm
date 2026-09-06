import { Prisma } from "@prisma/client";
import { plainDateFromDb, plainDateToDb } from "@/lib/dates";
import {
  followUpDueDate,
  followUpTaskTitle,
  type HappeningDates,
} from "@/lib/happenings";

type Tx = Prisma.TransactionClient;

/**
 * Keeps a happening's "ask how it went" follow-up in step with the happening.
 *
 * The follow-up is an ordinary `Task`, deliberately. It then rides everything
 * a task already has — the tasks page, the open-tasks widget, the daily digest
 * and the `INCOMPLETE_TASK_DUE` reminder policy — instead of needing a new
 * `ReminderEntity`, a new scheduler branch and a second delivery ledger to
 * reach the same phone.
 *
 * Takes a transaction client so the happening and its task move together: a
 * half-applied edit would leave a task asking about a trip whose dates no
 * longer exist.
 */

export interface FollowUpInput extends HappeningDates {
  id: string;
  ownerId: string;
  contactId: string;
  title: string;
  followUpTaskId: string | null;
}

/** Read a happening's date fields off a row into the shape the pure helpers take. */
export function happeningDatesOf(row: {
  date: Date;
  precision: HappeningDates["precision"];
  endDate: Date | null;
  endPrecision: HappeningDates["endPrecision"];
}): HappeningDates {
  return {
    date: plainDateFromDb(row.date),
    precision: row.precision,
    endDate: row.endDate ? plainDateFromDb(row.endDate) : null,
    endPrecision: row.endPrecision,
  };
}

/**
 * Create, re-date, or stand down the follow-up task, and return the id the
 * happening should now point at.
 *
 * Removing one is conditional on purpose. An incomplete follow-up is a
 * reminder nobody has acted on, so unticking the box should take it away. A
 * completed one is a record that you did ask — deleting that on an unrelated
 * edit would destroy history a status change has no business touching.
 */
export async function syncFollowUpTask(
  tx: Tx,
  happening: FollowUpInput,
  wanted: boolean,
): Promise<string | null> {
  const existing = happening.followUpTaskId
    ? await tx.task.findFirst({
        where: { id: happening.followUpTaskId, ownerId: happening.ownerId },
        select: { id: true, completedAt: true },
      })
    : null;

  if (!wanted) {
    if (existing && existing.completedAt === null) {
      await tx.task.delete({ where: { id: existing.id } });
    }
    return null;
  }

  const title = followUpTaskTitle(happening.title);
  const dueDate = plainDateToDb(followUpDueDate(happening));

  if (existing) {
    // A follow-up you already did stays done and keeps its wording; re-dating a
    // completed task would resurrect it on the overdue list.
    if (existing.completedAt !== null) return existing.id;
    await tx.task.update({ where: { id: existing.id }, data: { title, dueDate } });
    return existing.id;
  }

  const created = await tx.task.create({
    data: {
      ownerId: happening.ownerId,
      contactId: happening.contactId,
      title,
      dueDate,
      notes: null,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Drop the follow-up when the happening itself is deleted.
 *
 * Nothing cascades here: the foreign key runs from `Happening` to `Task`, so
 * deleting the happening would otherwise strand an open task asking about
 * something the user has just said they no longer want recorded. A completed
 * one survives, for the reason above.
 */
export async function deleteFollowUpTask(
  tx: Tx,
  ownerId: string,
  followUpTaskId: string | null,
): Promise<void> {
  if (!followUpTaskId) return;
  await tx.task.deleteMany({
    where: { id: followUpTaskId, ownerId, completedAt: null },
  });
}
