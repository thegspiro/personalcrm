"use client";

import * as React from "react";
import Link from "next/link";
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
import { useAction, useAddAction } from "@/components/form/use-action";
import { formatPartialDate, formatPartialRange, type DatePrecision } from "@/lib/date-precision";
import { formatMoney, termColorClasses } from "@/lib/format";
import { summarizeDebts, type DebtDirection } from "@/lib/debts";
import {
  DIETARY_GROUPS,
  DIETARY_KINDS,
  DIETARY_KIND_LABELS,
  mustAvoid,
  type DietaryKind,
} from "@/lib/dietary";
import type { PlainDate } from "@/lib/dates";
import {
  createDebt,
  createDietaryNeed,
  createFact,
  createGift,
  createIdea,
  createImportantDate,
  createLifeEvent,
  createRelationship,
  createTask,
  deleteDebt,
  deleteDietaryNeed,
  deleteFact,
  deleteGift,
  deleteIdea,
  deleteImportantDate,
  deleteLifeEvent,
  deleteRelationship,
  deleteTask,
  setIdeaStatus,
  setTaskDone,
  settleDebt,
} from "@/server/actions/details";

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
              placeholder="Reads Le Carré. Hates surprises. Grew up in Lagos."
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

// --- dietary needs ---------------------------------------------------------

export interface DietaryItem {
  id: string;
  kind: DietaryKind;
  label: string;
  notes: string | null;
  carriesEpinephrine: boolean;
}

/**
 * What someone can't, or won't, eat.
 *
 * Two headings only, whatever the four kinds record — see `@/lib/dietary`. The
 * add form opens on Allergy rather than on nothing, because the two ways of
 * getting this wrong do not cost the same.
 */
export function DietarySection({
  contactId,
  needs,
}: {
  contactId: string;
  needs: DietaryItem[];
}) {
  const run = useAction();
  const add = useAddAction();
  const [kind, setKind] = React.useState<DietaryKind>("ALLERGY");

  const groups = DIETARY_GROUPS.map((group) => ({
    ...group,
    items: needs.filter((need) => group.kinds.includes(need.kind as never)),
  })).filter((group) => group.items.length > 0);

  return (
    <SectionCard
      title="Food and drink to avoid"
      icon="UtensilsCrossed"
      count={needs.length}
      addLabel="Add a dietary need"
      form={(close) => (
        <form action={add(createDietaryNeed, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="kind" value={kind} />

          <Field label="What should they avoid?" htmlFor="diet-label">
            <Input id="diet-label" name="label" required placeholder="Shellfish" />
          </Field>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">What kind?</span>
            <div className="flex flex-wrap gap-1.5">
              {DIETARY_KINDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 py-1 text-xs transition-colors",
                    kind === option
                      ? "border-accent-8 bg-accent-3 text-accent-11"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {DIETARY_KIND_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <Field label="Anything else worth knowing?" htmlFor="diet-notes">
            <Textarea
              id="diet-notes"
              name="notes"
              rows={2}
              placeholder="Fine with it cooked, reacts to it raw."
            />
          </Field>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="carriesEpinephrine" value="true" className="size-4" />
            Carries adrenaline for this
          </label>

          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {needs.length === 0 ? (
        <SectionEmpty>Nothing noted — worth asking before you cook for them.</SectionEmpty>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="grid gap-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.heading}
            </h3>
            {group.items.map((need) => (
              <SectionRow
                key={need.id}
                className={mustAvoid(need.kind) ? "border-destructive/40 bg-destructive/5" : undefined}
                onDelete={() => void run(() => deleteDietaryNeed(need.id), "Removed")}
                deleteLabel="Remove dietary need"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{need.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {DIETARY_KIND_LABELS[need.kind]}
                  </span>
                  {need.carriesEpinephrine ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Carries adrenaline
                    </Badge>
                  ) : null}
                </div>
                {need.notes ? (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                    {need.notes}
                  </p>
                ) : null}
              </SectionRow>
            ))}
          </div>
        ))
      )}
    </SectionCard>
  );
}

// --- debts -----------------------------------------------------------------

export interface DebtItem {
  id: string;
  direction: DebtDirection;
  description: string;
  amountCents: number | null;
  currency: string;
  incurredOn: PlainDate;
  settledOn: PlainDate | null;
  notes: string | null;
  isPrivate: boolean;
}

/**
 * Money and things that have moved and not come back.
 *
 * Settled rows stay, behind a disclosure — that someone always pays you back is
 * worth as much as knowing they owe you now, but it shouldn't crowd out what is
 * still outstanding.
 */
export function DebtsSection({ contactId, debts }: { contactId: string; debts: DebtItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const [showSettled, setShowSettled] = React.useState(false);

  const summary = summarizeDebts(
    debts.map((debt) => ({
      direction: debt.direction,
      amountCents: debt.amountCents,
      currency: debt.currency,
      settled: debt.settledOn !== null,
    })),
  );

  const outstanding = debts.filter((debt) => !debt.settledOn);
  const settled = debts.filter((debt) => debt.settledOn);

  return (
    <SectionCard
      title="Lent and borrowed"
      icon="Scale"
      count={outstanding.length}
      addLabel="Add a debt"
      defaultOpen={false}
      form={(close) => (
        <form action={add(createDebt, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />

          <Field label="What was it?" htmlFor="debt-description">
            <Input id="debt-description" name="description" required placeholder="Covered dinner" />
          </Field>

          <Field label="Which way?" htmlFor="debt-direction">
            <select
              id="debt-direction"
              name="direction"
              defaultValue="THEY_OWE_ME"
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="THEY_OWE_ME">They owe me</option>
              <option value="I_OWE_THEM">I owe them</option>
            </select>
          </Field>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="How much?" htmlFor="debt-amount" hint="Leave empty if you lent a thing.">
              <Input
                id="debt-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
              />
            </Field>
            <DateField name="incurredOn" label="When" hint="Defaults to today." />
          </div>

          <Field label="Notes" htmlFor="debt-notes">
            <Textarea id="debt-notes" name="notes" rows={2} />
          </Field>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="isPrivate" value="true" className="size-4" />
            Hide this behind the privacy lock
          </label>

          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {summary.balances.length > 0 || summary.itemCount > 0 ? (
        <div className="grid gap-0.5 px-1 text-xs">
          {summary.balances.map((balance) => (
            <p key={balance.currency} className="text-muted-foreground">
              {balance.theyOweCents > 0 ? (
                <span>They owe you {formatMoney(balance.theyOweCents, balance.currency)}</span>
              ) : null}
              {balance.theyOweCents > 0 && balance.youOweCents > 0 ? <span> · </span> : null}
              {balance.youOweCents > 0 ? (
                <span>You owe them {formatMoney(balance.youOweCents, balance.currency)}</span>
              ) : null}
              {balance.netCents !== null ? (
                <span className="font-medium text-foreground">
                  {" "}
                  · net {formatMoney(Math.abs(balance.netCents), balance.currency)}{" "}
                  {balance.netCents >= 0 ? "your way" : "their way"}
                </span>
              ) : null}
            </p>
          ))}
          {summary.itemCount > 0 ? (
            <p className="text-muted-foreground">
              {summary.itemCount} {summary.itemCount === 1 ? "thing" : "things"} lent, no sum
              attached
            </p>
          ) : null}
        </div>
      ) : null}

      {outstanding.length === 0 ? (
        <SectionEmpty>Nothing outstanding.</SectionEmpty>
      ) : (
        outstanding.map((debt) => (
          <SectionRow
            key={debt.id}
            onDelete={() => void run(() => deleteDebt(debt.id), "Removed")}
            deleteLabel="Delete debt"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm">{debt.description}</span>
              {formatMoney(debt.amountCents, debt.currency) ? (
                <span className="text-sm font-medium">
                  {formatMoney(debt.amountCents, debt.currency)}
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {debt.direction === "THEY_OWE_ME" ? "they owe you" : "you owe them"}
              </span>
              {debt.isPrivate ? <Icon name="EyeOff" className="size-3 text-muted-foreground" /> : null}
            </div>
            {debt.notes ? (
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{debt.notes}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void run(() => settleDebt(debt.id, new Date()), "Settled")}
              className="mt-1 text-[11px] font-medium text-accent-11 hover:underline"
            >
              Mark settled
            </button>
          </SectionRow>
        ))
      )}

      {settled.length > 0 ? (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setShowSettled((v) => !v)}
            aria-expanded={showSettled}
            className="px-1 text-left text-[11px] font-medium text-muted-foreground hover:underline"
          >
            {settled.length} settled
          </button>
          {showSettled
            ? settled.map((debt) => (
                <SectionRow
                  key={debt.id}
                  className="opacity-70"
                  onDelete={() => void run(() => deleteDebt(debt.id), "Removed")}
                  deleteLabel="Delete debt"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm line-through">{debt.description}</span>
                    {formatMoney(debt.amountCents, debt.currency) ? (
                      <span className="text-xs text-muted-foreground">
                        {formatMoney(debt.amountCents, debt.currency)}
                      </span>
                    ) : null}
                  </div>
                </SectionRow>
              ))
            : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
