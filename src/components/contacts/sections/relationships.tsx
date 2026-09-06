"use client";

import Link from "next/link";
import { displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { SubmitButton } from "@/components/form/submit-button";
import { TermChips, type TermOption } from "@/components/form/term-select";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { createRelationship, deleteRelationship, updateRelationship } from "@/server/actions/details";

export interface RelationshipItem {
  id: string;
  typeId: string;
  type: { label: string; icon: string | null; color: string | null };
  other: { id: string; firstName: string; lastName: string | null };
}

export function RelationshipsSection({
  contactId,
  relationships,
  types,
  contacts,
}: {
  contactId: string;
  relationships: RelationshipItem[];
  types: TermOption[];
  contacts: PickerContact[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();

  return (
    <SectionCard
      title="Connected people"
      icon="Network"
      count={relationships.length}
      addLabel="Link someone"
      defaultOpen={false}
      form={(close) => (
        <form action={add(createRelationship, close, "Linked")} className="grid gap-2.5">
          <input type="hidden" name="fromContactId" value={contactId} />
          <ContactPicker
            name="toContactId"
            label="Who"
            contacts={contacts.filter((c) => c.id !== contactId)}
            multiple={false}
            required
          />
          <TermChips name="typeId" label="Is their…" terms={types} allowEmpty={false} />
          <SubmitButton size="sm">Link</SubmitButton>
        </form>
      )}
    >
      {relationships.length === 0 ? (
        <SectionEmpty>No connections recorded.</SectionEmpty>
      ) : (
        relationships.map((relationship) => (
          <SectionRow
            key={relationship.id}
            onDelete={() => void run(() => deleteRelationship(relationship.id), "Unlinked")}
            deleteLabel="Remove link"
            editLabel="Change relationship"
            editForm={(close) => (
              // Only the word for the link is editable. Pointing it at someone
              // else is not a correction, it is a different link — unlink and
              // link again, which is also what keeps the reciprocal honest.
              <form action={edit(updateRelationship, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={relationship.id} />
                <p className="text-xs text-muted-foreground">
                  {displayName(relationship.other)} is…
                </p>
                <TermChips
                  name="typeId"
                  terms={types}
                  defaultValue={relationship.typeId}
                  allowEmpty={false}
                />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
          >
            <Link href={`/people/${relationship.other.id}`} className="flex items-center gap-2">
              {relationship.type.icon ? (
                <Icon name={relationship.type.icon} className="size-3.5 text-muted-foreground" />
              ) : null}
              <span className="truncate text-sm font-medium">
                {displayName(relationship.other)}
              </span>
              <span className="text-xs text-muted-foreground">{relationship.type.label}</span>
            </Link>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
