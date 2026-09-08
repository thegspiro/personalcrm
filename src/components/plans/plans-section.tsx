"use client";

import * as React from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { cn, displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { DateField } from "@/components/form/date-field";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { PlacePicker, type PlaceSuggestion } from "@/components/form/place-picker";
import {
  SectionCard,
  SectionEmpty,
  SectionRow,
} from "@/components/contacts/section-card";
import { formatPartialDate } from "@/lib/date-precision";
import { formatDistance, type Distance } from "@/lib/geo";
import { formatMoney, termColorClasses } from "@/lib/format";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import {
  readPlanChecklist,
  STARTER_PLAN_CHECKLIST,
  type PlanChecklistItem,
} from "@/lib/plan-checklist";
import {
  formatPlanDuration,
  formatPlanTime,
  planMinuteToInput,
} from "@/lib/plan-time";
import {
  effectivePlanReminderDays,
  planReminderPolicyLabel,
  type ReminderPolicy,
} from "@/lib/reminders";
import {
  completePlan,
  createPlan,
  deletePlan,
  schedulePlan,
  setPlanChecklistItem,
  setPlanStatus,
  updatePlan,
} from "@/server/actions/details";

/**
 * Things to do — the list of what you've been meaning to do with someone.
 *
 * One component serves every home it has. On a person's page it is scoped to
 * them; on /ideas and /dating `contactId` is null, the list spans everyone, and
 * each row says who it is for. The category, the place and the link are all
 * optional: three words jotted down is still worth keeping, and the fields are
 * there for when you know more.
 */

export interface PlanItem {
  id: string;
  title: string;
  status: "OPEN" | "PLANNED" | "DONE" | "ARCHIVED";
  location: string | null;
  address: string | null;
  url: string | null;
  estimatedCostCents: number | null;
  currency: string;
  notes: string | null;
  checklist: unknown;
  plannedFor: PlainDate | null;
  plannedStartMinute: number | null;
  plannedDurationMinutes: number | null;
  reminderDaysBefore: ReminderPolicy;
  categoryId: string | null;
  category: { label: string; icon: string | null; color: string | null } | null;
  contact: { id: string; firstName: string; lastName: string | null } | null;
  /**
   * How far the plan's place is from wherever the page is measuring. Null
   * whenever either end has no coordinates, which is every plan until an
   * address is placed — so the chip simply is not there rather than reading
   * zero.
   */
  distance?: Distance | null;
  /**
   * The saved place the venue resolved to, if it resolved to one. Present
   * whenever the plan was given a venue that matched — `mapLinkFor` falls back
   * to a search when the place has no coordinates, so the link is worth having
   * either way. The distance is the part that needs both ends placed.
   */
  place?: { name: string; mapHref: string } | null;
}

export interface PlanPerson {
  id: string;
  firstName: string;
  lastName: string | null;
}

/**
 * Adding a plan and correcting one, from one description.
 *
 * `updatePlan` writes every field the form carries, so any field offered only
 * when adding would be cleared the first time the plan was edited. The one
 * exception is who it is with, which `updatePlan` leaves alone: moving a plan
 * to a different person is not a correction, and the plan's own contact is
 * what scopes it on their page.
 */
/** Rough lengths, so "set aside" is one tap rather than arithmetic. */
const PLAN_DURATIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1½ hours" },
  { minutes: 120, label: "2 hours" },
  { minutes: 180, label: "3 hours" },
  { minutes: 240, label: "Most of an evening" },
  { minutes: 480, label: "Most of a day" },
] as const;

/**
 * Which preset a stored policy is, so reopening a form shows the choice that
 * was made rather than resetting it. Null and an empty list both read as "No
 * reminders": null is what every plan saved before this shipped carries, and
 * `parseReminderDays("disabled")` writes the empty list. Neither sends
 * anything, so offering them as two different answers would be a distinction
 * without a difference.
 */
function planReminderMode(policy: ReminderPolicy): string {
  if (policy === null || policy.length === 0) return "disabled";
  if (policy.length === 1 && policy[0] === 0) return "on-day";
  if (policy.length === 1 && policy[0] === 1) return "day-before";
  if (policy.length === 1 && policy[0] === 7) return "week";
  return "custom";
}

/**
 * The reminder control, in both places a plan gets a day.
 *
 * Off unless asked for. Null means no reminders on a plan — deliberately the
 * opposite of an important date, where null is the account default: a birthday
 * is a fact the app may volunteer, and an evening you arranged is not something
 * it should start announcing on its own.
 *
 * One component rather than two copies because the two forms write the same
 * column, and the server reads the control by presence: a form that renders one
 * field and not the other would send a mode with nothing to read the offsets
 * from.
 */
function PlanReminderFields({
  idPrefix,
  policy,
}: {
  idPrefix: string;
  policy: ReminderPolicy;
}) {
  return (
    <>
      {/* What was on screen when this form was drawn, so the action can tell a
          choice the user made from the value they simply left alone. The select
          is always submitted, so without this a sheet opened before another tab
          switched a reminder on would post its own stale answer over the newer
          one. Comparing against the stored row cannot stand in: by the time the
          action reads it, the row already holds the newer value. */}
      <input
        type="hidden"
        name="reminderPolicyWas"
        value={effectivePlanReminderDays(policy).join(", ")}
      />
      <Field label="Remind me" htmlFor={`${idPrefix}-reminderMode`}>
        <select
          id={`${idPrefix}-reminderMode`}
          name="reminderMode"
          defaultValue={planReminderMode(policy)}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="disabled">No reminders</option>
          <option value="on-day">On the day</option>
          <option value="day-before">1 day before</option>
          <option value="week">1 week before</option>
          <option value="custom">Custom offsets</option>
        </select>
      </Field>
      <Field
        label="Custom days before"
        htmlFor={`${idPrefix}-reminderDaysBefore`}
        hint="Only read when “Custom offsets” is chosen. Comma-separated; 0 means on the day."
      >
        <Input
          id={`${idPrefix}-reminderDaysBefore`}
          name="reminderDaysBefore"
          inputMode="numeric"
          defaultValue={policy?.join(", ") ?? ""}
          placeholder="1, 0"
        />
      </Field>
    </>
  );
}

function PlanFields({
  formId,
  categories,
  contactId,
  people,
  plan,
  places,
  placesTruncated,
}: {
  formId: string;
  categories: TermOption[];
  contactId: string | null;
  people: PlanPerson[];
  plan?: PlanItem;
  places: PlaceSuggestion[];
  placesTruncated: boolean;
}) {
  // Filled by the picker, leaving `defaultValue` the single source of the
  // entered venue.
  const locationRef = React.useRef<HTMLInputElement>(null);
  const [checklist, setChecklist] = React.useState<PlanChecklistItem[]>(() =>
    plan
      ? readPlanChecklist(plan.checklist)
      : STARTER_PLAN_CHECKLIST.map((item) => ({ ...item })),
  );

  function updateChecklist(id: string, patch: Partial<PlanChecklistItem>) {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  // The server takes any whole number of minutes, so a stored value that is
  // not one of the presets has to be offered too. Without it the select falls
  // back to the blank option, and saving an unrelated edit would silently
  // clear a duration the user had set.
  const durationOptions = React.useMemo(() => {
    const stored = plan?.plannedDurationMinutes;
    if (!stored || PLAN_DURATIONS.some((option) => option.minutes === stored)) {
      return [...PLAN_DURATIONS];
    }
    return [...PLAN_DURATIONS, { minutes: stored, label: formatPlanDuration(stored) ?? `${stored}m` }]
      .sort((a, b) => a.minutes - b.minutes);
  }, [plan?.plannedDurationMinutes]);

  function addChecklistItem() {
    if (checklist.length >= 25) return;
    setChecklist((items) => [
      ...items,
      { id: crypto.randomUUID(), text: "", completed: false },
    ]);
  }

  return (
    <>
      <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border/70 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Idea
        </legend>
        <Field label="What do you want to do?" htmlFor={`${formId}-title`}>
          <Input
            id={`${formId}-title`}
            name="title"
            required
            maxLength={191}
            defaultValue={plan?.title ?? ""}
            placeholder="Late showing at the Alamo"
          />
        </Field>
        <TermChips
          name="categoryId"
          label="What kind of thing?"
          terms={categories}
          defaultValue={plan?.categoryId}
        />
        {plan === undefined && contactId === null && people.length > 0 ? (
          <Field label="Who with?" htmlFor={`${formId}-contact`}>
            <select
              id={`${formId}-contact`}
              name="contactId"
              defaultValue=""
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="">Anyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{displayName(person)}</option>
              ))}
            </select>
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border/70 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          When and where
        </legend>
        <DateField
          name="plannedFor"
          idPrefix={`${formId}-plannedFor`}
          label="Pencilled in for"
          allowPrecision={false}
          presets={["today"]}
          defaultValue={plan?.plannedFor ? plainDateKey(plan.plannedFor) : undefined}
          hint="Optional — leave it empty and it just sits on the list."
        />
        {/* Only meaningful alongside a day, and the action drops it when there
            isn't one. Deliberately not disabled while the day is empty:
            DateField reports a date being picked but not being cleared, so a
            disabled state here would latch on and lock the field. */}
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          <Field
            label="Start time"
            htmlFor={`${formId}-plannedStartTime`}
            hint="Only used once a day is set."
          >
            <Input
              id={`${formId}-plannedStartTime`}
              name="plannedStartTime"
              type="time"
              defaultValue={planMinuteToInput(plan?.plannedStartMinute)}
            />
          </Field>
          <PlanReminderFields idPrefix={formId} policy={plan?.reminderDaysBefore ?? null} />

          <Field label="Set aside" htmlFor={`${formId}-plannedDurationMinutes`}>
            <select
              id={`${formId}-plannedDurationMinutes`}
              name="plannedDurationMinutes"
              defaultValue={String(plan?.plannedDurationMinutes ?? "")}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="">However long it takes</option>
              {durationOptions.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          <Field label="Venue" htmlFor={`${formId}-location`}>
            <Input id={`${formId}-location`} name="location" ref={locationRef} maxLength={191} defaultValue={plan?.location ?? ""} placeholder="Alamo Drafthouse" />
            <PlacePicker
              places={places}
              truncated={placesTruncated}
              onPick={(place) => {
                if (locationRef.current) locationRef.current.value = place.name;
              }}
            />
          </Field>
          <Field label="Complete address" htmlFor={`${formId}-address`}>
            <Input id={`${formId}-address`} name="address" maxLength={500} defaultValue={plan?.address ?? ""} placeholder="123 Main St, Arlington, VA" />
          </Field>
        </div>
        <Field label="Listing or map link" htmlFor={`${formId}-url`}>
          <Input id={`${formId}-url`} name="url" type="url" defaultValue={plan?.url ?? ""} placeholder="https://" />
        </Field>
      </fieldset>

      <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border/70 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Practical details
        </legend>
        <Field label="Estimated cost" htmlFor={`${formId}-cost`}>
          <Input id={`${formId}-cost`} name="estimatedCost" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={plan?.estimatedCostCents == null ? "" : plan.estimatedCostCents / 100} placeholder="0.00" />
        </Field>
        <Field label="Preparation notes" htmlFor={`${formId}-notes`} hint="Reservations, opening hours, transport, accessibility, dietary needs, weather backup, or an agreed meeting point.">
          <Textarea id={`${formId}-notes`} name="notes" rows={3} defaultValue={plan?.notes ?? ""} placeholder="Book ahead; meet by the main entrance." />
        </Field>

        <div className="min-w-0 space-y-2" aria-label="Preparation checklist">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Checklist</p>
              <p className="text-xs text-muted-foreground">Optional — edit or remove any suggestion.</p>
            </div>
            <button type="button" onClick={addChecklistItem} disabled={checklist.length >= 25} className="shrink-0 text-xs font-medium text-accent-11 disabled:opacity-50">
              Add item
            </button>
          </div>
          <input type="hidden" name="checklist" value={JSON.stringify(checklist.filter((item) => item.text.trim()))} />
          {checklist.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2">
              <Checkbox checked={item.completed} onCheckedChange={(checked) => updateChecklist(item.id, { completed: checked === true })} aria-label={`Mark ${item.text || `item ${index + 1}`} complete`} />
              <Input aria-label={`Checklist item ${index + 1}`} value={item.text} maxLength={191} onChange={(event) => updateChecklist(item.id, { text: event.target.value })} className="min-w-0 flex-1" />
              <button type="button" onClick={() => setChecklist((items) => items.filter((candidate) => candidate.id !== item.id))} aria-label={`Delete checklist item ${index + 1}`} className="shrink-0 text-xs text-muted-foreground hover:text-destructive">
                Delete
              </button>
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/**
 * Finished with, one way or the other.
 *
 * These rows only reach the list at all under "Including done", and every
 * server action that changes a plan's arrangements refuses them — so the row
 * shows what it was and offers the one control that still applies.
 */
function isClosed(plan: PlanItem): boolean {
  return plan.status === "DONE" || plan.status === "ARCHIVED";
}

/**
 * The preparation checklist, on the row rather than only inside the editor.
 *
 * It was being written and then never shown: you ticked "Reserve or buy
 * tickets" while filling the plan in, saved, and the row said nothing about it
 * — so the one question the list exists to answer, *is this booked yet*, needed
 * the edit form opened to read. The summary carries the count so that answer is
 * there without opening anything.
 *
 * Closed by default, open once the plan is actually arranged: an idea nobody has
 * picked a day for does not need its preparation on screen, and `/ideas` renders
 * up to 200 of these. `<details>` is presentation only here — unlike
 * `ScheduleSheet`, the items are already in the payload, so hiding them saves
 * nothing and there is nothing to build lazily.
 */
function PlanChecklist({
  plan,
  ticking,
  onTick,
}: {
  plan: PlanItem;
  ticking: ReadonlySet<string>;
  onTick: (itemId: string, completed: boolean) => void;
}) {
  const items = React.useMemo(() => readPlanChecklist(plan.checklist), [plan.checklist]);
  if (items.length === 0) return null;

  const done = items.filter((item) => item.completed).length;
  // `setPlanChecklistItem` refuses a closed plan, so a row that reads as
  // finished shows what was ticked and offers no control that could only error.
  const closed = isClosed(plan);

  return (
    <details className="mt-1" open={plan.status === "PLANNED"}>
      <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Checklist · {done} of {items.length}
      </summary>
      <ul className="mt-1 grid gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-start gap-2">
            <Checkbox
              checked={item.completed}
              disabled={closed || ticking.has(`${plan.id}:${item.id}`)}
              onCheckedChange={(checked) => onTick(item.id, checked === true)}
              aria-label={`Mark ${item.text} ${item.completed ? "not done" : "done"}`}
              className="mt-0.5 shrink-0"
            />
            <span
              className={cn(
                "min-w-0 flex-1 break-words text-xs [overflow-wrap:anywhere]",
                item.completed ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The schedule sheet's disclosure, which builds its contents only once opened.
 *
 * `/ideas` renders up to 200 plans and offers up to 500 contacts, and every
 * shared row carries this form with a picker naming all of them — as many as
 * 100,000 `<option>` elements in the payload and in the hydrated tree before
 * anybody has scheduled anything. `<details>` hides its content but React still
 * renders it, so the saving cannot come from CSS; and a plain `children` would
 * have been built by the caller before it ever arrived here, hence the
 * function — the same shape `SectionRow`'s `editForm` already uses.
 *
 * It stays mounted once opened, so closing the disclosure part-way through does
 * not throw away what was typed.
 */
function ScheduleSheet({ children }: { children: () => React.ReactNode }) {
  const [opened, setOpened] = React.useState(false);
  return (
    <details
      className="mt-1"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Schedule it
      </summary>
      {opened ? children() : null}
    </details>
  );
}


export function PlansSection({
  contactId = null,
  plans,
  categories,
  people = [],
  title = "Things to do",
  defaultOpen = true,
  places = [],
  placesTruncated = false,
}: {
  /** Null on a list page, where the section spans everyone. */
  contactId?: string | null;
  plans: PlanItem[];
  categories: TermOption[];
  /** Offered as "Who with?" only when the list is not already scoped. */
  people?: PlanPerson[];
  title?: string;
  defaultOpen?: boolean;
  /** Places you have already been, for the venue box. */
  places?: PlaceSuggestion[];
  placesTruncated?: boolean;
}) {
  const run = useAction();
  // Which rows have a completion in flight. `useAction` does not expose its
  // pending state, and a second click is a wasted round trip even though the
  // server refuses it — the in-place path by its atomic claim, the shared-idea
  // path by the unique key on the copy it writes.
  const [completing, setCompleting] = React.useState<ReadonlySet<string>>(new Set());
  // Which individual checklist items are mid-flight, keyed plan-and-item: one
  // row can have several ticks in the air at once, and each is its own request.
  const [ticking, setTicking] = React.useState<ReadonlySet<string>>(new Set());
  const add = useAddAction();
  const edit = useEditAction();

  function tick(planId: string, itemId: string, completed: boolean) {
    const key = `${planId}:${itemId}`;
    if (ticking.has(key)) return;
    setTicking((keys) => new Set(keys).add(key));
    void run(() => setPlanChecklistItem(planId, itemId, completed), "Saved").finally(() => {
      setTicking((keys) => {
        const next = new Set(keys);
        next.delete(key);
        return next;
      });
    });
  }

  function create(form: FormData) {
    if (contactId) form.set("contactId", contactId);
    return createPlan(form);
  }

  function update(plan: PlanItem) {
    return (form: FormData) => {
      form.set("id", plan.id);
      return updatePlan(form);
    };
  }

  return (
    <SectionCard
      title={title}
      icon="Sparkles"
      count={plans.length}
      defaultOpen={defaultOpen}
      addLabel="Add something to do"
      form={(close) => (
        <form action={add(create, close, "Saved")} className="grid gap-2.5">
          <PlanFields
            formId="plan-new"
            categories={categories}
            contactId={contactId}
            people={people}
            places={places}
            placesTruncated={placesTruncated}
          />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      )}
    >
      {plans.length === 0 ? (
        <SectionEmpty>
          Nothing saved yet — places, films, things to try.
        </SectionEmpty>
      ) : (
        plans.map((plan) => (
          <SectionRow
            key={plan.id}
            onDelete={() => void run(() => deletePlan(plan.id), "Removed")}
            deleteLabel="Delete plan"
            editLabel="Edit plan"
            editForm={(close) => (
              <form action={edit(update(plan), close, "Saved")} className="grid gap-2.5">
                <PlanFields
                  formId={`plan-${plan.id}`}
                  categories={categories}
                  contactId={contactId}
                  people={people}
                  plan={plan}
                  places={places}
                  placesTruncated={placesTruncated}
                />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
          >
            <div className="flex items-start gap-2">
              {/* Records what the plan became, not just that it is over:
                  `completePlan` writes the interaction and points the plan at
                  it, so the evening lands in the timeline.

                  Not offered on a row that is already closed. `completePlan`
                  refuses those outright, so on the "Including done" view this
                  would be a control whose only outcome is a red toast. */}
              {isClosed(plan) ? null : (
              <Checkbox
                checked={false}
                disabled={completing.has(plan.id)}
                onCheckedChange={() => {
                  // Both completion paths are single-use on the server, so
                  // this only saves the round trip and the second toast.
                  if (completing.has(plan.id)) return;
                  setCompleting((ids) => new Set(ids).add(plan.id));
                  const form = new FormData();
                  form.set("id", plan.id);
                  // A shared row on someone's page is being finished *with*
                  // them. Without this the action takes its no-contact branch,
                  // closes the plan, and the evening never reaches their
                  // timeline or their cadence.
                  if (contactId && plan.contact === null) form.set("contactId", contactId);
                  void run(() => completePlan(form), "Marked done").finally(() => {
                    setCompleting((ids) => {
                      const next = new Set(ids);
                      next.delete(plan.id);
                      return next;
                    });
                  });
                }}
                aria-label="Mark as done"
                className="mt-0.5"
              />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{plan.title}</span>
                  {plan.category ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                        termColorClasses(plan.category.color),
                      )}
                    >
                      {plan.category.icon ? (
                        <Icon name={plan.category.icon} className="size-3" />
                      ) : null}
                      {plan.category.label}
                    </span>
                  ) : null}
                  {plan.status === "PLANNED" ? (
                    <Badge variant="success">planned</Badge>
                  ) : null}
                  {isClosed(plan) ? (
                    <Badge variant="muted">{plan.status === "DONE" ? "done" : "archived"}</Badge>
                  ) : null}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {plan.location ? <span>{plan.location}</span> : null}
                  {/* The same control the date log has carried since places
                      were mapped: a pin that opens the venue rather than a pin
                      drawn beside text that does nothing. Labelled with the
                      distance when both ends are placed, and "Map" when they
                      are not — the link works either way, because `mapLinkFor`
                      falls back to a search. A plan whose venue was only ever
                      typed has no place and reads exactly as it did before. */}
                  {plan.place ? (
                    <a
                      href={plan.place.mapHref}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open ${plan.place.name} on a map`}
                      className="inline-flex shrink-0 items-center gap-0.5 text-accent-11 hover:underline"
                    >
                      <MapPin className="size-3" />
                      {plan.distance ? formatDistance(plan.distance) : "Map"}
                    </a>
                  ) : null}
                  {plan.address ? (
                    // Free text up to 500 characters, so a long unbroken one has to be
                    // allowed to break: layout.spec.ts asserts no route scrolls sideways.
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{plan.address}</span>
                  ) : null}
                  {plan.plannedFor ? (
                    <span>
                      {[
                        formatPartialDate(plan.plannedFor, "DAY", { short: true }),
                        formatPlanTime(plan.plannedStartMinute),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {/* Only where it could fire. A policy on an OPEN plan is
                      stored and honoured the moment it is scheduled, but the
                      scheduler reads PLANNED rows only, so saying "Reminder on
                      the day" beside something nobody has arranged yet would
                      promise a message that is not coming. */}
                  {plan.status === "PLANNED" &&
                  plan.plannedFor &&
                  effectivePlanReminderDays(plan.reminderDaysBefore).length > 0 ? (
                    <span>{planReminderPolicyLabel(plan.reminderDaysBefore)}</span>
                  ) : null}
                  {/* Its own chip rather than part of the day's. A duration is
                      kept when no day is set — how long a thing takes belongs
                      to the thing — so folding it in here would store the
                      value and then never show it. */}
                  {plan.plannedDurationMinutes ? (
                    <span>{formatPlanDuration(plan.plannedDurationMinutes)}</span>
                  ) : null}
                  {formatMoney(plan.estimatedCostCents, plan.currency) ? (
                    <span>
                      {formatMoney(plan.estimatedCostCents, plan.currency)}
                    </span>
                  ) : null}
                  {plan.contact ? (
                    // Redundant on the page of the person it is already for.
                    plan.contact.id === contactId ? null : (
                      <Link
                        href={`/people/${plan.contact.id}`}
                        className="hover:text-foreground"
                      >
                        {displayName(plan.contact)}
                      </Link>
                    )
                  ) : (
                    <span>Anyone</span>
                  )}
                </div>

                {plan.url ? (
                  <a
                    href={plan.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block truncate text-xs text-accent-11 hover:underline"
                  >
                    {plan.url}
                  </a>
                ) : null}

                {plan.notes ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {plan.notes}
                  </p>
                ) : null}

                <PlanChecklist
                  plan={plan}
                  ticking={ticking}
                  onTick={(itemId, completed) => tick(plan.id, itemId, completed)}
                />

                {/* Closed rows get the same control under a truer name. It puts
                    the plan back on the list and drops its pointer at the
                    interaction, which is what `setPlanStatus` has always done —
                    the outing itself stays in the timeline, so nothing that
                    happened is undone by changing your mind about the plan. */}
                {isClosed(plan) ? (
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => setPlanStatus(plan.id, "OPEN"), "Back on the list")
                    }
                    className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Back on the list
                  </button>
                ) : plan.status === "PLANNED" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => setPlanStatus(plan.id, "OPEN"), "Back on the list")
                    }
                    className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Not planned after all
                  </button>
                ) : (
                  <ScheduleSheet>
                    {() => (
                      <form
                        action={async (form) => {
                          form.set("id", plan.id);
                          await run(() => schedulePlan(form), "Scheduled");
                        }}
                        className="mt-2 grid gap-2.5 rounded-md bg-muted/30 p-2"
                      >
                        <DateField
                          name="plannedFor"
                          idPrefix={`schedule-${plan.id}-plannedFor`}
                          label="Which day?"
                          allowPrecision={false}
                          presets={["today"]}
                          required
                          defaultValue={plan.plannedFor ? plainDateKey(plan.plannedFor) : undefined}
                        />
                        <Field label="Start time" htmlFor={`schedule-${plan.id}-time`}>
                          <Input
                            id={`schedule-${plan.id}-time`}
                            name="plannedStartTime"
                            type="time"
                            defaultValue={planMinuteToInput(plan.plannedStartMinute)}
                          />
                        </Field>
                        <PlanReminderFields
                          idPrefix={`schedule-${plan.id}`}
                          policy={plan.reminderDaysBefore}
                        />
                        {/* A person's page scopes the section but passes no
                            `people`, so there is no picker here — and scheduling
                            a shared row would otherwise mark it planned for
                            nobody. The page already knows who it is about. */}
                        {plan.contact === null && contactId ? (
                          <>
                            <input type="hidden" name="contactId" value={contactId} />
                            <input type="hidden" name="keepInList" value="true" />
                          </>
                        ) : null}
                        {plan.contact === null && contactId === null && people.length > 0 ? (
                          <>
                            <Field label="Who with?" htmlFor={`schedule-${plan.id}-contact`}>
                              <select
                                id={`schedule-${plan.id}-contact`}
                                name="contactId"
                                defaultValue=""
                                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                              >
                                <option value="">Nobody yet</option>
                                {people.map((person) => (
                                  <option key={person.id} value={person.id}>
                                    {displayName(person)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {/* Saved against nobody, so it is offered on
                                everyone's page. Scheduling it with one person
                                would take it out of circulation for the rest,
                                so by default the evening becomes a copy and
                                this stays on the list. */}
                            <label className="flex items-start gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                name="keepInList"
                                value="true"
                                defaultChecked
                                className="mt-0.5"
                              />
                              <span>Keep this in Things to do for next time</span>
                            </label>
                          </>
                        ) : null}
                        <SubmitButton size="sm">Schedule it</SubmitButton>
                      </form>
                    )}
                  </ScheduleSheet>
                )}
              </div>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
