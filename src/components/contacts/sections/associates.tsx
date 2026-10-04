"use client";

import * as React from "react";
import Link from "next/link";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { NoteFields, NoteText, type NoteItem, type PersonOption } from "@/components/associates/note-parts";
import { splitName } from "@/lib/names";
import {
  createAssociate,
  createAssociateNote,
  promoteAssociate,
  unlinkAssociate,
  updateAssociate,
} from "@/server/actions/details";

export interface AssociateItem {
  id: string;
  name: string;
  /** How this contact knows them. */
  howTheyKnow: string | null;
  isPrivate: boolean;
  /** True whenever the entry has been promoted, even when the person is withheld. */
  isPromoted: boolean;
  /** The person it became. Null when unpromoted, or private while locked. */
  promoted: { id: string; name: string } | null;
  /** The other visible people whose lives they are in. */
  alsoKnownTo: PersonOption[];
  /** What this contact told you. */
  heardHere: NoteItem[];
  /** What you heard any other way. */
  heardElsewhere: NoteItem[];
}

/** Someone already noted through another contact, offered instead of a duplicate. */
export interface LinkableAssociate {
  id: string;
  name: string;
  knownTo: string[];
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
      <HowTheyKnowField formId={formId} defaultValue={entry?.howTheyKnow} />
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

function HowTheyKnowField({
  formId,
  defaultValue,
}: {
  formId: string;
  defaultValue?: string | null;
}) {
  return (
    <Field label="How do they know them?" htmlFor={`${formId}-how`}>
      <Input
        id={`${formId}-how`}
        name="howTheyKnow"
        maxLength={191}
        defaultValue={defaultValue ?? ""}
        placeholder="Colleague from the hospital"
      />
    </Field>
  );
}

/**
 * Adding someone: a new name, or one already noted through someone else.
 *
 * Picking an existing entry hides the name and privacy fields rather than
 * leaving them live — they would be ignored, and a control that looks like it
 * does something and does not is worse than one that is absent.
 */
function AddAssociateForm({
  contactId,
  linkable,
  action,
}: {
  contactId: string;
  linkable: LinkableAssociate[];
  action: (form: FormData) => void | Promise<void>;
}) {
  const [existing, setExisting] = React.useState("");

  return (
    <form action={action} className="grid gap-2.5">
      <input type="hidden" name="contactId" value={contactId} />
      {linkable.length > 0 ? (
        <Field label="Already noted through someone else?" htmlFor="acq-new-existing">
          <select
            id="acq-new-existing"
            name="associateId"
            value={existing}
            onChange={(event) => setExisting(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">No — someone new</option>
            {linkable.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.knownTo.length > 0
                  ? `${entry.name} (${entry.knownTo.join(", ")})`
                  : entry.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {existing ? (
        <HowTheyKnowField formId="acq-new" />
      ) : (
        <AssociateFields formId="acq-new" />
      )}
      <Field label="Anything to remember?" htmlFor="acq-new-notes">
        <Textarea
          id="acq-new-notes"
          name="notes"
          rows={2}
          maxLength={10_000}
          placeholder="On night shifts until March — ask how he's coping."
        />
      </Field>
      <SubmitButton size="sm">Add</SubmitButton>
    </form>
  );
}

/**
 * The people in someone's life who are not tracked themselves.
 *
 * Deliberately unlike "Connected people" directly below it: no contact picker
 * and no avatar, because these are notes rather than people. Each name opens
 * the associate's own page, which is where everything about them — across
 * every friend who knows them — is kept and corrected.
 *
 * What this friend told you and what you heard any other way are shown apart,
 * the second muted: it is there so you know it, not so you raise it with
 * someone who may never have heard it.
 */
export function AssociatesSection({
  contactId,
  contactName,
  associates,
  linkable,
  types,
}: {
  contactId: string;
  /** For the promote form's label: "Bob is Alice's…". */
  contactName: string;
  associates: AssociateItem[];
  linkable: LinkableAssociate[];
  types: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();
  // The promote and note forms open inside the row rather than in a dialog,
  // for the same reason adding is inline: on a phone a nested modal is a dead
  // end. Neither can borrow `SectionRow`'s edit slot, which the edit form holds.
  const [promoting, setPromoting] = React.useState<string | null>(null);
  const [noting, setNoting] = React.useState<string | null>(null);
  const firstName = contactName.split(" ")[0] || contactName;

  return (
    <SectionCard
      title="People in their life"
      icon="UsersRound"
      count={associates.length}
      addLabel="Add someone"
      form={(close) => (
        <AddAssociateForm
          contactId={contactId}
          linkable={linkable}
          action={add(createAssociate, close, "Noted")}
        />
      )}
    >
      {associates.length === 0 ? (
        <SectionEmpty>
          No one noted yet. Add the people they talk about, so you can ask after them.
        </SectionEmpty>
      ) : (
        associates.map((entry) => {
          const suggested = splitName(entry.name);
          const sources: PersonOption[] = [
            { id: contactId, name: contactName },
            ...entry.alsoKnownTo,
          ];
          return (
            <SectionRow
              key={entry.id}
              onDelete={() =>
                void run(() => unlinkAssociate(entry.id, contactId), "Removed")
              }
              deleteLabel="Remove entry"
              deleteConfirm={`Take ${entry.name} out of ${firstName}'s life? Unless they're in someone else's too, everything noted about them goes as well.`}
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
                        <input type="hidden" name="contactId" value={contactId} />
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
                  <Link
                    href={`/people/friends/${entry.id}`}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {entry.name}
                  </Link>
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
              {entry.alsoKnownTo.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Also known to {entry.alsoKnownTo.map((person) => person.name).join(", ")}
                </p>
              ) : null}

              {entry.heardHere.length > 0 ? (
                <ul className="mt-1.5 grid gap-1.5" aria-label={`What ${firstName} told you`}>
                  {entry.heardHere.map((note) => (
                    <li key={note.id}>
                      <NoteText note={note} showSource={false} />
                    </li>
                  ))}
                </ul>
              ) : null}

              {entry.heardElsewhere.length > 0 ? (
                <div className="mt-2 rounded-md border border-dashed border-border px-2 py-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Heard elsewhere — {firstName} may not know
                  </p>
                  <ul className="mt-1 grid gap-1.5">
                    {entry.heardElsewhere.map((note) => (
                      <li key={note.id}>
                        <NoteText note={note} muted />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.isPromoted ? null : noting === entry.id ? (
                <form
                  action={add(createAssociateNote, () => setNoting(null), "Noted")}
                  className="mt-2 grid gap-2.5"
                >
                  <input type="hidden" name="associateId" value={entry.id} />
                  <NoteFields
                    formId={`acq-${entry.id}-note`}
                    sources={sources}
                    defaultSourceId={contactId}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <SubmitButton size="sm">Save note</SubmitButton>
                    <button
                      type="button"
                      onClick={() => setNoting(null)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : promoting === entry.id ? (
                <form
                  action={add(promoteAssociate, () => setPromoting(null), "Now tracked")}
                  className="mt-2 grid gap-2.5"
                >
                  <input type="hidden" name="id" value={entry.id} />
                  <input type="hidden" name="contactId" value={contactId} />
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
                  <p className="text-xs text-muted-foreground">
                    Everything noted about them is copied onto their profile.
                  </p>
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
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => setNoting(entry.id)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Add a note
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromoting(entry.id)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Track as a person
                  </button>
                </div>
              )}
            </SectionRow>
          );
        })
      )}
    </SectionCard>
  );
}
