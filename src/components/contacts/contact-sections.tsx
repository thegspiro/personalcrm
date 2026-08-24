"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField } from "@/components/form/date-field";
import { TermChips, TermSelect, type TermOption } from "@/components/form/term-select";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SectionCard, SectionEmpty, SectionRow } from "./section-card";
import { formatPartialDate, formatPartialRange, type DatePrecision } from "@/lib/date-precision";
import { formatMoney, termColorClasses } from "@/lib/format";
import type { PlainDate } from "@/lib/dates";
import type { ActionResult } from "@/server/actions/helpers";
import {
  createFact,
  createGift,
  createIdea,
  createImportantDate,
  createLifeEvent,
  createRelationship,
  createTask,
  deleteFact,
  deleteGift,
  deleteIdea,
  deleteImportantDate,
  deleteLifeEvent,
  deleteRelationship,
  deleteTask,
  setIdeaStatus,
  setTaskDone,
} from "@/server/actions/details";

/** Wraps an action so every section gets the same toast + refresh behaviour. */
function useAction() {
  const router = useRouter();
  return React.useCallback(
    async (run: () => Promise<ActionResult<unknown>>, successMessage?: string) => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      if (successMessage) toast.success(successMessage);
      router.refresh();
      return true;
    },
    [router],
  );
}

/**
 * Wraps an add action so a successful submit collapses the panel. Leaving it
 * open with the typed text still sitting there makes the next click look like
 * it did nothing.
 */
function useAddAction() {
  const run = useAction();
  return React.useCallback(
    (
      action: (form: FormData) => Promise<ActionResult<unknown>>,
      close: () => void,
      message?: string,
    ) =>
      async (form: FormData) => {
        if (await run(() => action(form), message)) close();
      },
    [run],
  );
}

// --- facts -----------------------------------------------------------------

export interface FactItem {
  id: string;
  content: string;
  importance: number;
  isPrivate: boolean;
  category: { label: string; icon: string | null; color: string | null } | null;
}

export function FactsSection({
  contactId,
  facts,
  categories,
}: {
  contactId: string;
  facts: FactItem[];
  categories: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Things to know"
      icon="Lightbulb"
      count={facts.length}
      addLabel="Add a fact"
      form={(close) => (
        <form action={add(createFact, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What should you remember?" htmlFor="fact-content">
            <Textarea
              id="fact-content"
              name="content"
              rows={2}
              required
              placeholder="Allergic to shellfish — genuinely, not a preference."
            />
          </Field>
          <TermChips name="categoryId" label="Category" terms={categories} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="isPrivate" value="true" className="size-4" />
            Hide this behind the privacy lock
          </label>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {facts.length === 0 ? (
        <SectionEmpty>Nothing noted yet.</SectionEmpty>
      ) : (
        facts.map((fact) => (
          <SectionRow
            key={fact.id}
            onDelete={() => void run(() => deleteFact(fact.id), "Removed")}
            deleteLabel="Delete fact"
          >
            <p className={cn("text-sm", fact.importance >= 2 && "font-medium")}>{fact.content}</p>
            {fact.isPrivate ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-3 px-1.5 py-0.5 text-[11px] text-accent-11">
                Private
              </span>
            ) : null}
            {fact.category ? (
              <span
                className={cn(
                  "mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                  termColorClasses(fact.category.color),
                )}
              >
                {fact.category.icon ? <Icon name={fact.category.icon} className="size-3" /> : null}
                {fact.category.label}
              </span>
            ) : null}
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- important dates -------------------------------------------------------

export interface DateItem {
  id: string;
  label: string;
  date: PlainDate;
  precision: DatePrecision;
  recurrence: "NONE" | "ANNUAL" | "MONTHLY";
  type: { label: string; icon: string | null; color: string | null } | null;
}

export function DatesSection({
  contactId,
  dates,
  types,
}: {
  contactId: string;
  dates: DateItem[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Important dates"
      icon="CalendarDays"
      count={dates.length}
      addLabel="Add a date"
      form={(close) => (
        <form action={add(createImportantDate, close, "Date added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What is it?" htmlFor="date-label">
            <Input id="date-label" name="label" required placeholder="Wedding anniversary" />
          </Field>
          <DateField name="date" label="When" required presets={[]} />
          <TermSelect name="typeId" label="Type" terms={types} />
          <Field label="Repeats" htmlFor="date-recurrence">
            <select
              id="date-recurrence"
              name="recurrence"
              defaultValue="ANNUAL"
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="ANNUAL">Every year</option>
              <option value="MONTHLY">Every month</option>
              <option value="NONE">Just once</option>
            </select>
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {dates.length === 0 ? (
        <SectionEmpty>No dates yet.</SectionEmpty>
      ) : (
        dates.map((item) => (
          <SectionRow
            key={item.id}
            onDelete={() => void run(() => deleteImportantDate(item.id), "Removed")}
            deleteLabel="Delete date"
          >
            <div className="flex items-center gap-2">
              {item.type?.icon ? (
                <Icon name={item.type.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">{item.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatPartialDate(item.date, item.precision)}
              {item.recurrence === "ANNUAL" ? " · yearly" : item.recurrence === "MONTHLY" ? " · monthly" : ""}
            </p>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- life events -----------------------------------------------------------

export interface LifeEventItem {
  id: string;
  title: string;
  description: string | null;
  date: PlainDate;
  precision: DatePrecision;
  endDate: PlainDate | null;
  endPrecision: DatePrecision | null;
  isMilestone: boolean;
  type: { label: string; icon: string | null; color: string | null } | null;
}

/**
 * Things that happened to them. Separate from interactions because you weren't
 * necessarily there, and separate from important dates because you don't want a
 * yearly reminder about someone's bereavement.
 */
export function LifeEventsSection({
  contactId,
  events,
  types,
}: {
  contactId: string;
  events: LifeEventItem[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Life events"
      icon="Milestone"
      count={events.length}
      addLabel="Add a life event"
      form={(close) => (
        <form action={add(createLifeEvent, close, "Event added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What happened?" htmlFor="event-title">
            <Input id="event-title" name="title" required placeholder="Moved to Austin" />
          </Field>
          <DateField
            name="date"
            label="When"
            required
            presets={["lastYear"]}
            hint="Only know the year? Set the precision to 'Year only'."
          />
          <TermSelect name="typeId" label="Type" terms={types} />
          <Field label="Anything more?" htmlFor="event-description">
            <Textarea id="event-description" name="description" rows={2} />
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {events.length === 0 ? (
        <SectionEmpty>
          Nothing recorded. Good for backfilling history — jobs, moves, milestones.
        </SectionEmpty>
      ) : (
        events.map((event) => (
          <SectionRow
            key={event.id}
            onDelete={() => void run(() => deleteLifeEvent(event.id), "Removed")}
            deleteLabel="Delete life event"
          >
            <div className="flex items-center gap-2">
              {event.type?.icon ? (
                <Icon name={event.type.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">{event.title}</span>
              {event.isMilestone ? <Badge variant="muted">Milestone</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatPartialRange(event.date, event.precision, event.endDate, event.endPrecision)}
            </p>
            {event.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
            ) : null}
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- ideas -----------------------------------------------------------------

export interface IdeaItem {
  id: string;
  content: string;
  status: "OPEN" | "USED" | "ARCHIVED";
}

export function IdeasSection({ contactId, ideas }: { contactId: string; ideas: IdeaItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const open = ideas.filter((idea) => idea.status === "OPEN");

  return (
    <SectionCard
      title="Bring this up"
      icon="MessageSquareQuote"
      count={open.length}
      addLabel="Add an idea"
      form={(close) => (
        <form action={add(createIdea, close, "Saved")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What do you want to ask or mention?" htmlFor="idea-content">
            <Textarea
              id="idea-content"
              name="content"
              rows={2}
              required
              placeholder="Ask how the sourdough starter survived the move."
            />
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {open.length === 0 ? (
        <SectionEmpty>Nothing queued up.</SectionEmpty>
      ) : (
        open.map((idea) => (
          <SectionRow
            key={idea.id}
            onDelete={() => void run(() => deleteIdea(idea.id), "Removed")}
            deleteLabel="Delete idea"
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={false}
                onCheckedChange={() => void run(() => setIdeaStatus(idea.id, "USED"), "Marked used")}
                aria-label="Mark as brought up"
                className="mt-0.5"
              />
              <p className="text-sm">{idea.content}</p>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- tasks -----------------------------------------------------------------

export interface TaskItem {
  id: string;
  title: string;
  dueDate: PlainDate | null;
  completedAt: Date | null;
  priority: "LOW" | "NORMAL" | "HIGH";
}

export function TasksSection({ contactId, tasks }: { contactId: string; tasks: TaskItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const open = tasks.filter((task) => !task.completedAt);

  return (
    <SectionCard
      title="Follow-ups"
      icon="CircleCheck"
      count={open.length}
      addLabel="Add a follow-up"
      form={(close) => (
        <form action={add(createTask, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What do you need to do?" htmlFor="task-title">
            <Input id="task-title" name="title" required placeholder="Send the bakery recommendation" />
          </Field>
          <DateField name="dueDate" label="Due" allowPrecision={false} presets={["today"]} />
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
            deleteLabel="Delete follow-up"
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

// --- gifts -----------------------------------------------------------------

export interface GiftItem {
  id: string;
  name: string;
  status: "IDEA" | "RESERVED" | "PURCHASED" | "GIVEN";
  priceCents: number | null;
  currency: string;
  occasion: { label: string } | null;
}

export function GiftsSection({
  contactId,
  gifts,
  occasions,
}: {
  contactId: string;
  gifts: GiftItem[];
  occasions: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Gifts"
      icon="Gift"
      count={gifts.length}
      addLabel="Add a gift idea"
      defaultOpen={false}
      form={(close) => (
        <form action={add(createGift, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What is it?" htmlFor="gift-name">
            <Input id="gift-name" name="name" required placeholder="Banneton proofing basket" />
          </Field>
          <Field label="Link" htmlFor="gift-url">
            <Input id="gift-url" name="url" type="url" placeholder="https://" />
          </Field>
          <TermSelect name="occasionId" label="Occasion" terms={occasions} />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {gifts.length === 0 ? (
        <SectionEmpty>No gift ideas yet.</SectionEmpty>
      ) : (
        gifts.map((gift) => (
          <SectionRow
            key={gift.id}
            onDelete={() => void run(() => deleteGift(gift.id), "Removed")}
            deleteLabel="Delete gift"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm">{gift.name}</span>
              <Badge variant={gift.status === "GIVEN" ? "success" : "muted"}>
                {gift.status.toLowerCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {[gift.occasion?.label, formatMoney(gift.priceCents, gift.currency)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- relationships ---------------------------------------------------------

export interface RelationshipItem {
  id: string;
  type: { label: string; icon: string | null; color: string | null };
  other: { id: string; firstName: string; lastName: string | null };
}

export function RelationshipsSection({
  contactId,
  relationships,
  types,
  contacts,
}: {
  contactId: string;
  relationships: RelationshipItem[];
  types: TermOption[];
  contacts: PickerContact[];
}) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionCard
      title="Connected people"
      icon="Network"
      count={relationships.length}
      addLabel="Link someone"
      defaultOpen={false}
      form={(close) => (
        <form action={add(createRelationship, close, "Linked")} className="grid gap-2.5">
          <input type="hidden" name="fromContactId" value={contactId} />
          <ContactPicker
            name="toContactId"
            label="Who"
            contacts={contacts.filter((c) => c.id !== contactId)}
            multiple={false}
            required
          />
          <TermChips name="typeId" label="Is their…" terms={types} allowEmpty={false} />
          <SubmitButton size="sm">Link</SubmitButton>
        </form>
      )}
    >
      {relationships.length === 0 ? (
        <SectionEmpty>No connections recorded.</SectionEmpty>
      ) : (
        relationships.map((relationship) => (
          <SectionRow
            key={relationship.id}
            onDelete={() => void run(() => deleteRelationship(relationship.id), "Unlinked")}
            deleteLabel="Remove link"
          >
            <Link href={`/people/${relationship.other.id}`} className="flex items-center gap-2">
              {relationship.type.icon ? (
                <Icon name={relationship.type.icon} className="size-3.5 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">
                {displayName(relationship.other)}
              </span>
              <span className="text-xs text-muted-foreground">{relationship.type.label}</span>
            </Link>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
