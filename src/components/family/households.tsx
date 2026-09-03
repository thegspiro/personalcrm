"use client";

import * as React from "react";
import Link from "next/link";
import { displayName, initialsOf } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SectionCard, SectionEmpty } from "@/components/contacts/section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import {
  addHouseholdMember,
  createHousehold,
  deleteHousehold,
  removeHouseholdMember,
  updateHousehold,
} from "@/server/actions/family";

export interface HouseholdCardItem {
  id: string;
  name: string;
  notes: string | null;
  members: Array<{
    person: {
      id: string;
      firstName: string;
      lastName: string | null;
      nickname?: string | null;
      avatarPath?: string | null;
    };
    role: string | null;
  }>;
}

/**
 * Named groups of people who belong together.
 *
 * Explicitly named rather than inferred from a shared address: adult children,
 * separations, lodgers and multi-generation homes all break that guess, and a
 * household is as much "Mum and Dad's place" as it is an address.
 */
export function Households({
  households,
  contacts,
}: {
  households: HouseholdCardItem[];
  contacts: PickerContact[];
}) {
  const add = useAddAction();

  return (
    <SectionCard
      title="Households"
      icon="Home"
      count={households.length}
      addLabel="New household"
      form={(close) => (
        <form action={add(createHousehold, close, "Household created")} className="grid gap-2.5">
          <Field label="Name" htmlFor="household-name">
            <Input
              id="household-name"
              name="name"
              required
              maxLength={191}
              placeholder="The Whitfields"
            />
          </Field>
          <ContactPicker name="memberIds" label="Who's in it" contacts={contacts} />
          <Field label="Notes (optional)" htmlFor="household-notes">
            <Textarea id="household-notes" name="notes" rows={2} placeholder="Sunday lunches" />
          </Field>
          <SubmitButton size="sm">Create</SubmitButton>
        </form>
      )}
    >
      {households.length === 0 ? (
        <SectionEmpty>
          No households yet. Group the people who belong together — a family, a house, a set of
          in-laws — so you can see them at a glance.
        </SectionEmpty>
      ) : (
        households.map((household) => (
          <HouseholdCard key={household.id} household={household} contacts={contacts} />
        ))
      )}
    </SectionCard>
  );
}

function HouseholdCard({
  household,
  contacts,
}: {
  household: HouseholdCardItem;
  contacts: PickerContact[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const memberIds = new Set(household.members.map((m) => m.person.id));

  return (
    <div className="min-w-0 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{household.name}</h3>
          {household.notes ? (
            <p className="truncate text-xs text-muted-foreground">{household.notes}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setEditing(false);
            setAdding((v) => !v);
          }}
          aria-expanded={adding}
          // Named per household: a column of identical "Add someone" buttons
          // tells a screen-reader user nothing about which one they are in.
          aria-label={adding ? `Cancel adding to ${household.name}` : `Add someone to ${household.name}`}
        >
          {adding ? "Cancel" : "Add someone"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          // "Edit", not "Rename": an accessible name starting with "Rename"
          // contains the word "name", which makes a by-label lookup for the
          // household's own Name field ambiguous — it matched this button too.
          aria-label={editing ? `Cancel editing ${household.name}` : `Edit ${household.name}`}
          aria-expanded={editing}
          onClick={() => {
            setAdding(false);
            setEditing((v) => !v);
          }}
        >
          <Icon name="Pencil" className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Delete ${household.name}`}
          onClick={() => {
            if (!confirm(`Delete "${household.name}"? The people in it are not affected.`)) return;
            void run(() => deleteHousehold(household.id), "Household deleted");
          }}
        >
          <span aria-hidden>×</span>
        </Button>
      </div>

      {editing ? (
        <form
          action={edit(updateHousehold, () => setEditing(false), "Household updated")}
          className="mt-2.5 grid gap-2.5 border-t border-border/70 pt-2.5"
        >
          <input type="hidden" name="id" value={household.id} />
          <Field label="Name" htmlFor={`household-name-${household.id}`}>
            <Input
              id={`household-name-${household.id}`}
              name="name"
              required
              maxLength={191}
              defaultValue={household.name}
            />
          </Field>
          <Field label="Notes (optional)" htmlFor={`household-notes-${household.id}`}>
            <Textarea
              id={`household-notes-${household.id}`}
              name="notes"
              rows={2}
              defaultValue={household.notes ?? ""}
              placeholder="Sunday lunches"
            />
          </Field>
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      ) : null}

      {adding ? (
        <form
          action={add(addHouseholdMember, () => setAdding(false), "Added")}
          className="mt-2.5 grid gap-2.5 border-t border-border/70 pt-2.5"
        >
          <input type="hidden" name="householdId" value={household.id} />
          <ContactPicker
            name="contactId"
            label="Who"
            contacts={contacts.filter((c) => !memberIds.has(c.id))}
            multiple={false}
            required
          />
          <Field label="Their role here (optional)" htmlFor={`role-${household.id}`}>
            <Input id={`role-${household.id}`} name="role" maxLength={96} placeholder="Eldest" />
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      ) : null}

      {household.members.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nobody in this household yet.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {household.members.map((member) => (
            <li key={member.person.id}>
              <span className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 py-1 pl-1 pr-1.5">
                <Link
                  href={`/people/${member.person.id}`}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <Avatar className="size-5 shrink-0">
                    {member.person.avatarPath ? (
                      <AvatarImage src={member.person.avatarPath} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {initialsOf(member.person.firstName, member.person.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-xs font-medium">
                    {displayName(member.person)}
                  </span>
                  {member.role ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {member.role}
                    </span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  aria-label={`Remove ${displayName(member.person)} from ${household.name}`}
                  onClick={() =>
                    void run(
                      () => removeHouseholdMember(household.id, member.person.id),
                      "Removed",
                    )
                  }
                  className="shrink-0 rounded-full px-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <span aria-hidden>×</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Placeholder used by the tree when nothing has been recorded yet. */
export function FamilyEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <Icon name="Users" className="mx-auto size-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">No family recorded yet</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Link two people with <strong className="font-medium">Add a relative</strong> above, or open
        someone in{" "}
        <Link href="/people" className="underline">
          People
        </Link>{" "}
        and add a parent, sibling or partner there. Once a couple of links exist, the rest of the
        family gets suggested for you.
      </p>
    </div>
  );
}
