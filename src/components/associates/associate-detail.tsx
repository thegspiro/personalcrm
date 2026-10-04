"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { splitName } from "@/lib/names";
import {
  deleteAssociate,
  deleteAssociateNote,
  linkAssociate,
  mergeAssociates,
  promoteAssociate,
  unlinkAssociate,
  updateAssociate,
  updateAssociateLink,
  updateAssociateNote,
  createAssociateNote,
} from "@/server/actions/details";
import { NoteFields, NoteText, type NoteItem, type PersonOption } from "./note-parts";

export interface AssociateDetailItem {
  id: string;
  name: string;
  isPrivate: boolean;
  isPromoted: boolean;
  promoted: PersonOption | null;
  links: Array<{ contact: PersonOption; howTheyKnow: string | null }>;
  notes: NoteItem[];
}

export interface MergeCandidate {
  id: string;
  name: string;
  knownTo: string[];
}

const SELECT_CLASS = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm";

/**
 * Everything about one associate, across every friend who knows them.
 *
 * The one place a note can be corrected or removed, and the one place two
 * entries can be declared the same person — both need the whole picture,
 * which no single friend's page has.
 *
 * Read-only once promoted, like the row on a friend's page: what was written
 * before the profile existed is kept as a record, and can be thrown away but
 * not rewritten.
 */
export function AssociateDetail({
  associate,
  linkableContacts,
  candidates,
  types,
}: {
  associate: AssociateDetailItem;
  linkableContacts: PersonOption[];
  candidates: MergeCandidate[];
  types: TermOption[];
}) {
  const router = useRouter();
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();
  const readOnly = associate.isPromoted;
  const sources = associate.links.map((link) => link.contact);
  const details = associate.notes.filter((note) => note.kind === "DETAIL");
  const updates = associate.notes.filter((note) => note.kind === "UPDATE");

  async function removeLink(contactId: string) {
    const result = await unlinkAssociate(associate.id, contactId);
    if (result.ok && result.data?.deleted) {
      router.push("/people/friends");
      return;
    }
    await run(async () => result, "Removed");
  }

  function noteRow(note: NoteItem) {
    return (
      <SectionRow
        key={note.id}
        onDelete={() => void run(() => deleteAssociateNote(note.id), "Removed")}
        deleteLabel="Delete note"
        deleteConfirm="Delete this note?"
        editLabel="Edit note"
        editForm={
          readOnly
            ? undefined
            : (close) => (
                <form action={edit(updateAssociateNote, close, "Saved")} className="grid gap-2.5">
                  <input type="hidden" name="id" value={note.id} />
                  <NoteFields formId={`note-${note.id}`} note={note} sources={sources} />
                  <SubmitButton size="sm">Save</SubmitButton>
                </form>
              )
        }
      >
        <NoteText note={note} />
      </SectionRow>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <Link
          href="/people/friends"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Their people
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight">
            {associate.name}
          </h2>
          {associate.isPromoted ? <Badge variant="muted">Now tracked</Badge> : null}
          {associate.isPrivate ? <Badge>Private</Badge> : null}
        </div>
        {associate.promoted ? (
          <p className="text-xs text-muted-foreground">
            Now on your people list as{" "}
            <Link
              href={`/people/${associate.promoted.id}`}
              className="underline-offset-2 hover:underline"
            >
              {associate.promoted.name}
            </Link>
            . What follows is what you knew before.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not someone you keep in touch with yourself — someone your people talk about.
          </p>
        )}
      </div>

      <SectionCard
        title="What you know"
        icon="NotebookPen"
        count={associate.notes.length}
        addLabel={readOnly ? undefined : "Add a note"}
        form={
          readOnly
            ? undefined
            : (close) => (
                <form action={add(createAssociateNote, close, "Noted")} className="grid gap-2.5">
                  <input type="hidden" name="associateId" value={associate.id} />
                  <NoteFields
                    formId="note-new"
                    sources={sources}
                    defaultSourceId={sources.length === 1 ? sources[0]!.id : null}
                  />
                  <SubmitButton size="sm">Add</SubmitButton>
                </form>
              )
        }
      >
        {associate.notes.length === 0 ? (
          <SectionEmpty>
            Nothing noted yet. Each note remembers who told you, so you know who it is safe to
            bring it up with.
          </SectionEmpty>
        ) : (
          <>
            {updates.length > 0 ? (
              <h3 className="px-1 pt-1 text-xs font-medium text-muted-foreground">Recent news</h3>
            ) : null}
            {updates.map(noteRow)}
            {details.length > 0 ? (
              <h3 className="px-1 pt-1 text-xs font-medium text-muted-foreground">About them</h3>
            ) : null}
            {details.map(noteRow)}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="In whose life"
        icon="UsersRound"
        count={associate.links.length}
        addLabel={readOnly || linkableContacts.length === 0 ? undefined : "Add someone they know"}
        form={
          readOnly || linkableContacts.length === 0
            ? undefined
            : (close) => (
                <form action={add(linkAssociate, close, "Linked")} className="grid gap-2.5">
                  <input type="hidden" name="associateId" value={associate.id} />
                  <Field label="Who else knows them?" htmlFor="link-new-contact">
                    <select id="link-new-contact" name="contactId" required className={SELECT_CLASS}>
                      <option value="">Pick someone</option>
                      {linkableContacts.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="How do they know them?" htmlFor="link-new-how">
                    <Input id="link-new-how" name="howTheyKnow" maxLength={191} />
                  </Field>
                  <SubmitButton size="sm">Add</SubmitButton>
                </form>
              )
        }
      >
        {associate.links.map((link) => (
          <SectionRow
            key={link.contact.id}
            onDelete={() => void removeLink(link.contact.id)}
            deleteLabel={`Remove from ${link.contact.name}'s life`}
            deleteConfirm={
              associate.links.length === 1
                ? `Remove ${associate.name} from ${link.contact.name}'s life? Unless they're in someone else's too, everything noted about them goes as well.`
                : `Remove ${associate.name} from ${link.contact.name}'s life? Notes they told you stay.`
            }
            editLabel={`Edit how ${link.contact.name} knows them`}
            editForm={
              readOnly
                ? undefined
                : (close) => (
                    <form
                      action={edit(updateAssociateLink, close, "Saved")}
                      className="grid gap-2.5"
                    >
                      <input type="hidden" name="associateId" value={associate.id} />
                      <input type="hidden" name="contactId" value={link.contact.id} />
                      <Field
                        label="How do they know them?"
                        htmlFor={`link-${link.contact.id}-how`}
                      >
                        <Input
                          id={`link-${link.contact.id}-how`}
                          name="howTheyKnow"
                          maxLength={191}
                          defaultValue={link.howTheyKnow ?? ""}
                        />
                      </Field>
                      <SubmitButton size="sm">Save</SubmitButton>
                    </form>
                  )
            }
          >
            <Link
              href={`/people/${link.contact.id}`}
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              {link.contact.name}
            </Link>
            {link.howTheyKnow ? (
              <p className="text-xs text-muted-foreground">{link.howTheyKnow}</p>
            ) : null}
          </SectionRow>
        ))}
      </SectionCard>

      {readOnly ? null : (
        <SectionCard title="Name and privacy" icon="Pencil" defaultOpen={false}>
          <form action={edit(updateAssociate, () => {}, "Saved")} className="grid gap-2.5">
            <input type="hidden" name="id" value={associate.id} />
            <Field label="Their name" htmlFor="associate-name">
              <Input
                id="associate-name"
                name="name"
                required
                maxLength={191}
                defaultValue={associate.name}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="isPrivate"
                value="true"
                defaultChecked={associate.isPrivate}
                className="size-4"
              />
              Hide this behind the privacy lock
            </label>
            <SubmitButton size="sm">Save</SubmitButton>
          </form>
        </SectionCard>
      )}

      {candidates.length > 0 ? (
        <SectionCard title="Same person as someone else?" icon="Merge" defaultOpen={false}>
          <form
            action={add(
              mergeAssociates,
              () => {},
              "Merged",
            )}
            onSubmit={(event) => {
              if (!window.confirm(`Fold the other entry into ${associate.name}? Its notes and links move here.`)) {
                event.preventDefault();
              }
            }}
            className="grid gap-2.5"
          >
            <input type="hidden" name="keepId" value={associate.id} />
            <Field
              label={`${associate.name} is the same person as…`}
              htmlFor="merge-candidate"
              hint="Everything noted about them moves here, still saying who told you."
            >
              <select id="merge-candidate" name="mergeId" required className={SELECT_CLASS}>
                <option value="">Pick an entry</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.knownTo.length > 0
                      ? `${candidate.name} (${candidate.knownTo.join(", ")})`
                      : candidate.name}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton size="sm">Merge</SubmitButton>
          </form>
        </SectionCard>
      ) : null}

      {readOnly || associate.links.length === 0 ? null : (
        <PromoteCard associate={associate} types={types} />
      )}

      <div>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm(`Delete ${associate.name} and everything noted about them?`)) return;
            const result = await deleteAssociate(associate.id);
            if (result.ok) {
              router.push("/people/friends");
              return;
            }
            await run(async () => result);
          }}
          className="text-xs text-destructive-11 underline-offset-2 hover:underline"
        >
          Delete {associate.name}
        </button>
      </div>
    </div>
  );
}

function PromoteCard({
  associate,
  types,
}: {
  associate: AssociateDetailItem;
  types: TermOption[];
}) {
  const router = useRouter();
  const run = useAction();
  const suggested = splitName(associate.name);
  const [anchor, setAnchor] = React.useState(associate.links[0]?.contact.id ?? "");
  const anchorName =
    associate.links.find((link) => link.contact.id === anchor)?.contact.name ?? "their friend";

  async function promote(form: FormData) {
    const result = await promoteAssociate(form);
    if (result.ok && result.data) {
      router.push(`/people/${result.data.contactId}`);
      return;
    }
    await run(async () => result);
  }

  return (
    <SectionCard title="Track as a person" icon="UserPlus" defaultOpen={false}>
      <form action={promote} className="grid gap-2.5">
        <input type="hidden" name="id" value={associate.id} />
        <Field label="First name" htmlFor="promote-first">
          <Input
            id="promote-first"
            name="firstName"
            required
            maxLength={120}
            defaultValue={suggested.firstName}
          />
        </Field>
        <Field label="Last name" htmlFor="promote-last">
          <Input id="promote-last" name="lastName" maxLength={120} defaultValue={suggested.lastName} />
        </Field>
        {associate.links.length > 1 ? (
          <Field label="Connect them to" htmlFor="promote-anchor">
            <select
              id="promote-anchor"
              name="contactId"
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
              className={SELECT_CLASS}
            >
              {associate.links.map((link) => (
                <option key={link.contact.id} value={link.contact.id}>
                  {link.contact.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <input type="hidden" name="contactId" value={anchor} />
        )}
        <TermChips
          name="typeId"
          label={`${associate.name} is ${anchorName}'s…`}
          terms={types}
          allowEmpty={false}
        />
        <p className="text-xs text-muted-foreground">
          Everything noted about them is copied onto their profile, each note still saying who
          told you.
        </p>
        <SubmitButton size="sm">Track them</SubmitButton>
      </form>
    </SectionCard>
  );
}
