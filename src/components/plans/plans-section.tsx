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
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { formatPartialDate } from "@/lib/date-precision";
import { formatMoney, termColorClasses } from "@/lib/format";
import type { PlainDate } from "@/lib/dates";
import type { ActionResult } from "@/server/actions/helpers";
import { createPlan, deletePlan, setPlanStatus } from "@/server/actions/details";

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
  city: string | null;
  url: string | null;
  estimatedCostCents: number | null;
  currency: string;
  notes: string | null;
  plannedFor: PlainDate | null;
  category: { label: string; icon: string | null; color: string | null } | null;
  contact: { id: string; firstName: string; lastName: string | null } | null;
}

export interface PlanPerson {
  id: string;
  firstName: string;
  lastName: string | null;
}

function useRun() {
  const router = useRouter();
  return React.useCallback(
    async (run: () => Promise<ActionResult<unknown>>, message?: string) => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      if (message) toast.success(message);
      router.refresh();
      return true;
    },
    [router],
  );
}

export function PlansSection({
  contactId = null,
  plans,
  categories,
  people = [],
  title = "Things to do",
  defaultOpen = true,
}: {
  /** Null on a list page, where the section spans everyone. */
  contactId?: string | null;
  plans: PlanItem[];
  categories: TermOption[];
  /** Offered as "Who with?" only when the list is not already scoped. */
  people?: PlanPerson[];
  title?: string;
  defaultOpen?: boolean;
}) {
  const run = useRun();

  function add(close: () => void) {
    return async (form: FormData) => {
      if (contactId) form.set("contactId", contactId);
      if (await run(() => createPlan(form), "Saved")) close();
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
        <form action={add(close)} className="grid gap-2.5">
          <Field label="What do you want to do?" htmlFor="plan-title">
            <Input
              id="plan-title"
              name="title"
              required
              maxLength={191}
              placeholder="Late showing at the Alamo"
            />
          </Field>

          <TermChips name="categoryId" label="What kind of thing?" terms={categories} />

          {contactId === null && people.length > 0 ? (
            <Field label="Who with?" htmlFor="plan-contact">
              <select
                id="plan-contact"
                name="contactId"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value="">Anyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Where" htmlFor="plan-location">
              <Input id="plan-location" name="location" placeholder="Alamo Drafthouse" />
            </Field>
            <Field label="City" htmlFor="plan-city">
              <Input id="plan-city" name="city" placeholder="Arlington" />
            </Field>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Link" htmlFor="plan-url">
              <Input id="plan-url" name="url" type="url" placeholder="https://" />
            </Field>
            <Field label="Rough cost" htmlFor="plan-cost">
              <Input
                id="plan-cost"
                name="estimatedCost"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
              />
            </Field>
          </div>

          <DateField
            name="plannedFor"
            label="Pencilled in for"
            allowPrecision={false}
            presets={["today"]}
            hint="Optional — leave it empty and it just sits on the list."
          />

          <Field label="Notes" htmlFor="plan-notes">
            <Textarea
              id="plan-notes"
              name="notes"
              rows={2}
              placeholder="Book ahead, the balcony sells out."
            />
          </Field>

          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      )}
    >
      {plans.length === 0 ? (
        <SectionEmpty>Nothing saved yet — places, films, things to try.</SectionEmpty>
      ) : (
        plans.map((plan) => (
          <SectionRow
            key={plan.id}
            onDelete={() => void run(() => deletePlan(plan.id), "Removed")}
            deleteLabel="Delete plan"
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={false}
                onCheckedChange={() =>
                  void run(() => setPlanStatus(plan.id, "DONE"), "Marked done")
                }
                aria-label="Mark as done"
                className="mt-0.5"
              />
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
                  {plan.status === "PLANNED" ? <Badge variant="success">planned</Badge> : null}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {plan.location ? <span>{plan.location}</span> : null}
                  {plan.city ? <span>{plan.city}</span> : null}
                  {plan.plannedFor ? (
                    <span>{formatPartialDate(plan.plannedFor, "DAY", { short: true })}</span>
                  ) : null}
                  {formatMoney(plan.estimatedCostCents, plan.currency) ? (
                    <span>{formatMoney(plan.estimatedCostCents, plan.currency)}</span>
                  ) : null}
                  {plan.contact ? (
                    // Redundant on the page of the person it is already for.
                    plan.contact.id === contactId ? null : (
                      <Link href={`/people/${plan.contact.id}`} className="hover:text-foreground">
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

                <button
                  type="button"
                  onClick={() =>
                    void run(
                      () =>
                        setPlanStatus(plan.id, plan.status === "PLANNED" ? "OPEN" : "PLANNED"),
                      plan.status === "PLANNED" ? "Back on the list" : "Pencilled in",
                    )
                  }
                  className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {plan.status === "PLANNED" ? "Not planned after all" : "Pencil it in"}
                </button>
              </div>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
