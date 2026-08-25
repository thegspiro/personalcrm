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
import {
  createDateIdea,
  deleteDateIdea,
  setDateIdeaStatus,
} from "@/server/actions/dating";

/**
 * Date ideas — the list of things you've been meaning to do together.
 *
 * One component serves both homes. On a person's page it is scoped to them;
 * on /dating `contactId` is null, the whole list shows, and each row says who
 * it is for. The category, the place and the link are all optional: an idea
 * you jot as three words is still worth keeping, and the fields are there for
 * when you know more.
 */

export interface DateIdeaItem {
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

export interface DateIdeaPerson {
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

export function DateIdeasSection({
  contactId = null,
  ideas,
  categories,
  people = [],
  defaultOpen = true,
}: {
  /** Null on /dating, where the list spans everyone. */
  contactId?: string | null;
  ideas: DateIdeaItem[];
  categories: TermOption[];
  /** Offered as "Who for?" only when the list is not already scoped. */
  people?: DateIdeaPerson[];
  defaultOpen?: boolean;
}) {
  const run = useRun();

  function add(close: () => void) {
    return async (form: FormData) => {
      if (contactId) form.set("contactId", contactId);
      if (await run(() => createDateIdea(form), "Saved")) close();
    };
  }

  return (
    <SectionCard
      title="Date ideas"
      icon="Sparkles"
      count={ideas.length}
      defaultOpen={defaultOpen}
      addLabel="Add a date idea"
      form={(close) => (
        <form action={add(close)} className="grid gap-2.5">
          <Field label="What's the idea?" htmlFor="idea-title">
            <Input
              id="idea-title"
              name="title"
              required
              maxLength={191}
              placeholder="Late showing at the Alamo"
            />
          </Field>

          <TermChips name="categoryId" label="What kind of thing?" terms={categories} />

          {contactId === null && people.length > 0 ? (
            <Field label="Who for?" htmlFor="idea-contact">
              <select
                id="idea-contact"
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
            <Field label="Where" htmlFor="idea-location">
              <Input id="idea-location" name="location" placeholder="Alamo Drafthouse" />
            </Field>
            <Field label="City" htmlFor="idea-city">
              <Input id="idea-city" name="city" placeholder="Arlington" />
            </Field>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Link" htmlFor="idea-url">
              <Input id="idea-url" name="url" type="url" placeholder="https://" />
            </Field>
            <Field label="Rough cost" htmlFor="idea-cost">
              <Input
                id="idea-cost"
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

          <Field label="Notes" htmlFor="idea-notes">
            <Textarea
              id="idea-notes"
              name="notes"
              rows={2}
              placeholder="Book ahead, the balcony sells out."
            />
          </Field>

          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      )}
    >
      {ideas.length === 0 ? (
        <SectionEmpty>Nothing saved yet — places, films, things to try.</SectionEmpty>
      ) : (
        ideas.map((idea) => (
          <SectionRow
            key={idea.id}
            onDelete={() => void run(() => deleteDateIdea(idea.id), "Removed")}
            deleteLabel="Delete idea"
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={false}
                onCheckedChange={() =>
                  void run(() => setDateIdeaStatus(idea.id, "DONE"), "Marked done")
                }
                aria-label="Mark as done"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{idea.title}</span>
                  {idea.category ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                        termColorClasses(idea.category.color),
                      )}
                    >
                      {idea.category.icon ? (
                        <Icon name={idea.category.icon} className="size-3" />
                      ) : null}
                      {idea.category.label}
                    </span>
                  ) : null}
                  {idea.status === "PLANNED" ? <Badge variant="success">planned</Badge> : null}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {idea.location ? <span>{idea.location}</span> : null}
                  {idea.city ? <span>{idea.city}</span> : null}
                  {idea.plannedFor ? (
                    <span>{formatPartialDate(idea.plannedFor, "DAY", { short: true })}</span>
                  ) : null}
                  {formatMoney(idea.estimatedCostCents, idea.currency) ? (
                    <span>{formatMoney(idea.estimatedCostCents, idea.currency)}</span>
                  ) : null}
                  {idea.contact ? (
                    // Redundant on the page of the person it is already for.
                    idea.contact.id === contactId ? null : (
                      <Link href={`/people/${idea.contact.id}`} className="hover:text-foreground">
                        {displayName(idea.contact)}
                      </Link>
                    )
                  ) : (
                    <span>Anyone</span>
                  )}
                </div>

                {idea.url ? (
                  <a
                    href={idea.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block truncate text-xs text-accent-11 hover:underline"
                  >
                    {idea.url}
                  </a>
                ) : null}

                {idea.notes ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {idea.notes}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() =>
                    void run(
                      () =>
                        setDateIdeaStatus(idea.id, idea.status === "PLANNED" ? "OPEN" : "PLANNED"),
                      idea.status === "PLANNED" ? "Back on the list" : "Pencilled in",
                    )
                  }
                  className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {idea.status === "PLANNED" ? "Not planned after all" : "Pencil it in"}
                </button>
              </div>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
