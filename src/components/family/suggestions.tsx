"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/form/submit-button";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { useAction, useAddAction } from "@/components/form/use-action";
import { acceptSuggestion, dismissSuggestion } from "@/server/actions/family";

export interface SuggestionItem {
  subjectId: string;
  personId: string;
  subjectName: string;
  personName: string;
  reason: string;
  termId: string | null;
  termLabel: string | null;
}

/**
 * Relationships the app thinks exist but has not recorded.
 *
 * Every card shows its reasoning and defaults to the type it inferred, but
 * nothing is written until you press Add — and the type stays editable, because
 * the correction that matters most ("sibling" → "half-sibling") is one tap.
 */
export function SuggestionList({
  suggestions,
  types,
  showSubject = false,
  footer = null,
}: {
  suggestions: SuggestionItem[];
  types: TermOption[];
  /** On /family a card has to say who it is about; on a contact page it doesn't. */
  showSubject?: boolean;
  /** Rendered under the cards — where /family says the list was cut short. */
  footer?: React.ReactNode;
}) {
  if (suggestions.length === 0) return null;

  return (
    // min-w-0: this is a grid item, and grid items default to min-width:auto —
    // which the truncating name below inflates to the full untruncated width.
    <section className="min-w-0 rounded-xl border border-dashed border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <Icon name="Sparkles" className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-sm font-semibold">Possible relatives</h3>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {suggestions.length}
        </span>
      </div>
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        Worked out from links you have already recorded. Nothing is saved until you add it.
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 px-4 pb-4">
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={`${suggestion.subjectId}:${suggestion.personId}`}
            suggestion={suggestion}
            types={types}
            showSubject={showSubject}
          />
        ))}
        {footer}
      </div>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  types,
  showSubject,
}: {
  suggestion: SuggestionItem;
  types: TermOption[];
  showSubject: boolean;
}) {
  const run = useAction();
  const add = useAddAction();
  const [open, setOpen] = React.useState(false);

  const who = showSubject
    ? `${suggestion.personName} as ${suggestion.subjectName}'s relative`
    : suggestion.personName;

  return (
    <div className="min-w-0 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-sm font-medium">
            <Link href={`/people/${suggestion.personId}`} className="hover:underline">
              {suggestion.personName}
            </Link>
            {suggestion.termLabel ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                maybe {showSubject ? `${suggestion.subjectName}'s ` : "their "}
                {suggestion.termLabel.toLowerCase()}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{suggestion.reason}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          // Named per person: a column of identical "Add" buttons is
          // unusable with a screen reader.
          aria-label={open ? `Cancel adding ${who}` : `Add ${who}`}
        >
          {open ? "Cancel" : "Add"}
        </Button>
      </div>

      {open ? (
        <form
          action={add(acceptSuggestion, () => setOpen(false), "Linked")}
          className="mt-2.5 grid gap-2.5 border-t border-border/70 pt-2.5"
        >
          <input type="hidden" name="fromContactId" value={suggestion.subjectId} />
          <input type="hidden" name="toContactId" value={suggestion.personId} />
          <TermSelect
            // Per pair, because more than one card can be open at once and two
            // selects sharing the id `typeId` make each label point at the
            // first one in the document rather than its own.
            id={`suggested-type-${suggestion.subjectId}-${suggestion.personId}`}
            name="typeId"
            label={`${suggestion.personName} is ${showSubject ? `${suggestion.subjectName}'s` : "their"}…`}
            terms={types}
            defaultValue={suggestion.termId}
          />
          <div className="flex items-center gap-2">
            <SubmitButton size="sm">{`Add ${suggestion.personName}`}</SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Not related to ${who}`}
              onClick={() => {
                const form = new FormData();
                form.set("fromContactId", suggestion.subjectId);
                form.set("toContactId", suggestion.personId);
                void run(() => dismissSuggestion(form), "Won't suggest again");
              }}
            >
              Not related
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
