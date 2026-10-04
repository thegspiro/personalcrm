"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { DateField } from "@/components/form/date-field";
import { formatPartialDate, type DatePrecision } from "@/lib/date-precision";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** The client's copy of `AssociateNoteView` — plain data, safe to serialise. */
export interface NoteItem {
  id: string;
  kind: "DETAIL" | "UPDATE";
  content: string;
  date: PlainDate | null;
  precision: DatePrecision;
  heardFrom: { id: string; name: string } | null;
}

export interface PersonOption {
  id: string;
  name: string;
}

/**
 * The fields shared by adding a note and correcting one.
 *
 * Written once so the two can never drift: a field that exists only on the way
 * in is a field an edit silently clears, because the action reads the whole
 * form and writes what it finds.
 *
 * `sources` are the people whose lives the associate is in. An edit keeps the
 * note's current source in the list even when that link has since gone, or
 * opening the form would quietly re-attribute it on save.
 */
export function NoteFields({
  formId,
  note,
  sources,
  defaultSourceId = null,
}: {
  formId: string;
  note?: NoteItem;
  sources: PersonOption[];
  defaultSourceId?: string | null;
}) {
  const [kind, setKind] = React.useState<"DETAIL" | "UPDATE">(note?.kind ?? "UPDATE");
  const current = note ? note.heardFrom : null;
  const options =
    current && !sources.some((person) => person.id === current.id)
      ? [...sources, current]
      : sources;
  const selected = note ? (note.heardFrom?.id ?? "") : (defaultSourceId ?? "");

  return (
    <>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
          What kind of note?
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="kind"
              value="UPDATE"
              checked={kind === "UPDATE"}
              onChange={() => setKind("UPDATE")}
              className="size-4"
            />
            Recent news
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="kind"
              value="DETAIL"
              checked={kind === "DETAIL"}
              onChange={() => setKind("DETAIL")}
              className="size-4"
            />
            Something about them
          </label>
        </div>
      </fieldset>
      <Field label="What do you know?" htmlFor={`${formId}-content`}>
        <Textarea
          id={`${formId}-content`}
          name="content"
          required
          rows={2}
          maxLength={10_000}
          defaultValue={note?.content ?? ""}
          placeholder={
            kind === "UPDATE" ? "Started night shifts at the hospital." : "Has two kids, into climbing."
          }
        />
      </Field>
      {kind === "UPDATE" ? (
        <DateField
          name="date"
          idPrefix={`${formId}-date`}
          label="As of"
          defaultValue={note?.date ? plainDateKey(note.date) : null}
          defaultPrecision={note?.kind === "UPDATE" ? note.precision : "DAY"}
          hint="Leave it blank for today."
        />
      ) : null}
      <Field label="Who told you?" htmlFor={`${formId}-source`}>
        <select
          id={`${formId}-source`}
          name="heardFromContactId"
          defaultValue={selected}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">Them directly, or not sure</option>
          {options.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** "Mar 3, 2026" on an update, nothing on a detail. */
export function noteDate(note: NoteItem): string | null {
  return note.kind === "UPDATE" && note.date
    ? formatPartialDate(note.date, note.precision, { short: true })
    : null;
}

/** Who a note came from, as a phrase that reads after the note. */
export function noteSource(note: NoteItem): string {
  return note.heardFrom ? `from ${note.heardFrom.name}` : "from them directly";
}

/**
 * One note's text, its date, and — unless the context already says it —
 * where it came from.
 *
 * `muted` is for a note heard from someone other than the friend whose page
 * this is: it is shown so you know it, and styled so it does not read as
 * something to bring up.
 */
export function NoteText({
  note,
  showSource = true,
  muted = false,
}: {
  note: NoteItem;
  showSource?: boolean;
  muted?: boolean;
}) {
  const date = noteDate(note);
  const meta = [date, showSource ? noteSource(note) : null].filter(Boolean).join(" · ");
  return (
    <div className={cn("min-w-0", muted && "text-muted-foreground")}>
      <p className="whitespace-pre-line break-words text-sm">{note.content}</p>
      {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
    </div>
  );
}
