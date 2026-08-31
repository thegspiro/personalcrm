"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { termColorClasses } from "@/lib/format";
import { createFact, deleteFact, updateFact } from "@/server/actions/details";

export interface FactItem {
  id: string;
  content: string;
  importance: number;
  isPrivate: boolean;
  /** Carried alongside the label so the edit form can preselect the chip. */
  categoryId: string | null;
  category: { label: string; icon: string | null; color: string | null } | null;
}

/**
 * The fields shared by adding a fact and correcting one.
 *
 * Written once so the two can never drift: a field that exists only on the way
 * in is a field an edit silently clears, because the action reads the whole
 * form and writes what it finds.
 */
function FactFields({
  formId,
  categories,
  fact,
}: {
  formId: string;
  categories: TermOption[];
  fact?: FactItem;
}) {
  return (
    <>
      <Field label="What should you remember?" htmlFor={`${formId}-content`}>
        <Textarea
          id={`${formId}-content`}
          name="content"
          rows={2}
          required
          defaultValue={fact?.content ?? ""}
          placeholder="Reads Le Carré. Hates surprises. Grew up in Lagos."
        />
      </Field>
      <TermChips
        name="categoryId"
        label="Category"
        terms={categories}
        defaultValue={fact?.categoryId}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="isPrivate"
          value="true"
          defaultChecked={fact?.isPrivate ?? false}
          className="size-4"
        />
        Hide this behind the privacy lock
      </label>
    </>
  );
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
          <FactFields formId="fact-new" categories={categories} />
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
            editLabel="Edit fact"
            editForm={(close) => (
              <form action={add(updateFact, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={fact.id} />
                <FactFields formId={`fact-${fact.id}`} categories={categories} fact={fact} />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
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
