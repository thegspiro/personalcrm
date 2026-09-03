"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SectionCard, SectionEmpty } from "@/components/contacts/section-card";
import { useAddAction } from "@/components/form/use-action";
import { createRelationship } from "@/server/actions/details";

/**
 * Linking two relatives from the family page itself.
 *
 * Until this existed `/family` was read-only: the page that shows you the gap
 * in the family could not fill it, and the only way to record a link was to
 * remember which of the two people to open in People first. Both ends are
 * picked here, in the order the sentence reads — "Wren is Idris's parent" —
 * because the direction is the part that gets recorded backwards.
 *
 * The write goes through the same `createRelationship` action the contact page
 * uses, so both halves of the pair are still written together and nothing new
 * can reach the database by a shorter route.
 */
export function AddRelative({
  contacts,
  familyTypes,
}: {
  contacts: PickerContact[];
  /** Only the family relationship terms — the rest live in Connected people. */
  familyTypes: TermOption[];
}) {
  const add = useAddAction();
  const [subjectId, setSubjectId] = React.useState<string | null>(null);

  return (
    <SectionCard
      title="Add a relative"
      icon="Users"
      addLabel="Link two people"
      defaultOpen={false}
      form={(close) => (
        <form
          action={add(createRelationship, () => {
            setSubjectId(null);
            close();
          }, "Linked")}
          className="grid gap-2.5"
        >
          <ContactPicker
            name="fromContactId"
            label="Whose relative"
            contacts={contacts}
            multiple={false}
            required
            onSelectionChange={(ids) => setSubjectId(ids[0] ?? null)}
          />
          <TermSelect
            // Explicit id: the suggestion cards on this same page also render a
            // `typeId` select, and two elements sharing an id point the label
            // at whichever the browser finds first — not the one you tapped.
            id="family-page-link-type"
            name="typeId"
            label="They are this person's…"
            terms={familyTypes}
          />
          <ContactPicker
            name="toContactId"
            label="Who"
            // Someone cannot be their own relative, and the action rejects it —
            // better not to offer the option than to explain the refusal.
            contacts={contacts.filter((contact) => contact.id !== subjectId)}
            multiple={false}
            required
          />
          <Field label="Family context (optional)" htmlFor="family-page-link-notes">
            <Textarea
              id="family-page-link-notes"
              name="notes"
              rows={2}
              placeholder="How they fit into the family, co-parenting context, or anything useful to remember."
            />
          </Field>
          <SubmitButton size="sm">Link</SubmitButton>
        </form>
      )}
    >
      <SectionEmpty>
        Pick two people and say how they are related. The reverse link is recorded at the same
        time, so it reads correctly from either side.
      </SectionEmpty>
    </SectionCard>
  );
}
