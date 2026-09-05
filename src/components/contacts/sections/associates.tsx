"use client";

import * as React from "react";
import Link from "next/link";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { splitName } from "@/lib/names";
import {
  createAssociate,
  deleteAssociate,
  promoteAssociate,
  updateAssociate,
} from "@/server/actions/details";

export interface AssociateItem {
  id: string;
  name: string;
  howTheyKnow: string | null;
  notes: string | null;
  isPrivate: boolean;
  /** True whenever the entry has been promoted, even when the person is withheld. */
  isPromoted: boolean;
  /** The person it became. Null when unpromoted, or private while locked. */
  promoted: { id: string; name: string } | null;
}

/**
 * The fields shared by adding an entry and correcting one.
 *
 * Written once so the two can never drift: a field that exists only on the way
 * in is a field an edit silently clears, because the action reads the whole
 * form and writes what it finds.
 */
function AssociateFields({
  formId,
  entry,
}: {
  formId: string;
  entry?: AssociateItem;
}) {
  return (
    <>
      <Field label="Their name" htmlFor={`${formId}-name`}>
        <Input
          id={`${formId}-name`}
          name="name"
          required
          maxLength={191}
          defaultValue={entry?.name ?? ""}
          placeholder="Bob"
        />
      </Field>
      <Field label="How do they know them?" htmlFor={`${formId}-how`}>
        <Input
          id={`${formId}-how`}
          name="howTheyKnow"
          maxLength={191}
          defaultValue={entry?.howTheyKnow ?? ""}
          placeholder="Colleague from the hospital"
        />
      </Field>
      <Field label="Anything to remember?" htmlFor={`${formId}-notes`}>
        <Textarea
          id={`${formId}-notes`}
          name="notes"
          rows={2}
          defaultValue={entry?.notes ?? ""}
          placeholder="On night shifts until March — ask how he's coping."
        />
      </Field>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="isPrivate"
          value="true"
          defaultChecked={entry?.isPrivate ?? false}
          className="size-4"
        />
        Hide this behind the privacy lock
      </label>
    </>
  );
}

/**
 * The people in someone's life who are not tracked themselves.
 *
 * Deliberately unlike "Connected people" directly below it: no contact picker,
 * no avatar, and no link on a row — because there is nothing to navigate to
 * until an entry is promoted, and that absence is the clearest signal that
 * these are notes rather than people.
 */
export function AssociatesSection({
  contactId,
  contactName,
  associates,
  types,
}: {
  contactId: string;
  /** For the promote form's label: "Bob is Alice's…". */
  contactName: string;
  associates: AssociateItem[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();
  // The promote form opens inside the row rather than in a dialog, for the
  // same reason adding is inline: on a phone a nested modal is a dead end.
  // It cannot borrow `SectionRow`'s edit slot, which the edit form holds.
  const [promoting, setPromoting] = React.useState<string | null>(null);

  return (
    <SectionCard
      title="People in their life"
      icon="UsersRound"
      count={associates.length}
      addLabel="Add someone"
      form={(close) => (
        <form action={add(createAssociate, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <AssociateFields formId="acq-new" />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {associates.length === 0 ? (
        <SectionEmpty>
          No one noted yet. Add the people they talk about, so you can ask after them.
        </SectionEmpty>
      ) : (
        associates.map((entry) => {
          const suggested = splitName(entry.name);
          return (
            <SectionRow
              key={entry.id}
              onDelete={() => void run(() => deleteAssociate(entry.id), "Removed")}
              deleteLabel="Remove entry"
              deleteConfirm={
                entry.isPromoted
                  ? "Remove this note? The person you created stays."
                  : undefined
              }
              editLabel="Edit entry"
              // No edit slot once promoted, so the row renders no pencil at
              // all: read-only comes from the row's own API rather than from a
              // control that looks live and refuses.
              editForm={
                entry.isPromoted
                  ? undefined
                  : (close) => (
                      <form
                        action={edit(updateAssociate, close, "Saved")}
                        className="grid gap-2.5"
                      >
                        <input type="hidden" name="id" value={entry.id} />
                        <AssociateFields formId={`acq-${entry.id}`} entry={entry} />
                        <SubmitButton size="sm">Save</SubmitButton>
                      </form>
                    )
              }
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {entry.promoted ? (
                  <Link
                    href={`/people/${entry.promoted.id}`}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {entry.promoted.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium">{entry.name}</span>
                )}
                {entry.isPromoted ? (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    Now tracked
                  </span>
                ) : null}
                {entry.isPrivate ? (
                  <span className="inline-flex items-center rounded-full bg-accent-3 px-1.5 py-0.5 text-[11px] text-accent-11">
                    Private
                  </span>
                ) : null}
              </div>
              {entry.howTheyKnow ? (
                <p className="text-xs text-muted-foreground">{entry.howTheyKnow}</p>
              ) : null}
              {entry.notes ? (
                <p className="mt-1 whitespace-pre-line text-sm">{entry.notes}</p>
              ) : null}

              {entry.isPromoted ? null : promoting === entry.id ? (
                <form
                  action={add(promoteAssociate, () => setPromoting(null), "Now tracked")}
                  className="mt-2 grid gap-2.5"
                >
                  <input type="hidden" name="id" value={entry.id} />
                  <Field label="First name" htmlFor={`acq-${entry.id}-first`}>
                    <Input
                      id={`acq-${entry.id}-first`}
                      name="firstName"
                      required
                      maxLength={120}
                      defaultValue={suggested.firstName}
                    />
                  </Field>
                  <Field label="Last name" htmlFor={`acq-${entry.id}-last`}>
                    <Input
                      id={`acq-${entry.id}-last`}
                      name="lastName"
                      maxLength={120}
                      defaultValue={suggested.lastName}
                    />
                  </Field>
                  <TermChips
                    name="typeId"
                    label={`${entry.name} is ${contactName}'s…`}
                    terms={types}
                    allowEmpty={false}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <SubmitButton size="sm">Track them</SubmitButton>
                    <button
                      type="button"
                      onClick={() => setPromoting(null)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setPromoting(entry.id)}
                  className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Track as a person
                </button>
              )}
            </SectionRow>
          );
        })
      )}
    </SectionCard>
  );
}
