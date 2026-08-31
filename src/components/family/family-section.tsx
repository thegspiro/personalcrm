"use client";

import * as React from "react";
import Link from "next/link";
import { cn, displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { SubmitButton } from "@/components/form/submit-button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { ContactPicker, type PickerContact } from "@/components/form/contact-picker";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { termColorClasses } from "@/lib/format";
import { FAMILY_TIER_LABELS, type FamilyTier } from "@/lib/family";
import { createRelationship, deleteRelationship } from "@/server/actions/details";
import {
  addHouseholdMember,
  endRelationshipLink,
  removeHouseholdMember,
} from "@/server/actions/family";

export interface FamilyLinkItem {
  id: string;
  person: { id: string; firstName: string; lastName: string | null; nickname?: string | null };
  term: { label: string; icon: string | null; color: string | null };
  notes: string | null;
  canEnd: boolean;
}

export interface FamilyTierGroup {
  tier: FamilyTier;
  links: FamilyLinkItem[];
}

export interface HouseholdItem {
  id: string;
  name: string;
  members: Array<{
    person: { id: string; firstName: string; lastName: string | null; nickname?: string | null };
    role: string | null;
  }>;
}

/**
 * Family on a contact page.
 *
 * Split out from "Connected people" because family is the part you scan for —
 * grouping fourteen relatives in with three coworkers and a landlord buries
 * exactly the thing you opened the page to check.
 */
export function FamilySection({
  contactId,
  tiers,
  familyTypes,
  contacts,
}: {
  contactId: string;
  tiers: FamilyTierGroup[];
  /** Only the family relationship terms — the rest live in Connected people. */
  familyTypes: TermOption[];
  contacts: PickerContact[];
}) {
  const run = useAction();
  const add = useAddAction();
  const count = tiers.reduce((total, group) => total + group.links.length, 0);

  return (
    <SectionCard
      title="Family"
      icon="Home"
      count={count}
      addLabel="Add a relative"
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
          <TermSelect name="typeId" label="Is their…" terms={familyTypes} />
          <Field label="Family context (optional)" htmlFor="family-link-notes">
            <Textarea
              id="family-link-notes"
              name="notes"
              rows={2}
              placeholder="How they fit into the family, co-parenting context, or anything useful to remember."
            />
          </Field>
          <SubmitButton size="sm">Link</SubmitButton>
        </form>
      )}
    >
      {count === 0 ? (
        <SectionEmpty>No family recorded yet.</SectionEmpty>
      ) : (
        tiers.map((group) => (
          <div key={group.tier} className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {FAMILY_TIER_LABELS[group.tier]}
            </h3>
            {group.links.map((link) => (
              <FamilyRow key={link.id} link={link} onDelete={run} />
            ))}
          </div>
        ))
      )}
    </SectionCard>
  );
}

/**
 * One family link, with the option to end it.
 *
 * Ending is offered instead of deleting for anything that can end, because a
 * divorce rarely means you stop knowing the person — often the opposite, if
 * there are children involved. The link is re-typed, not removed, so the
 * history and any notes survive.
 */
function FamilyRow({
  link,
  onDelete,
}: {
  link: FamilyLinkItem;
  onDelete: ReturnType<typeof useAction>;
}) {
  const add = useAddAction();
  const [ending, setEnding] = React.useState(false);

  return (
    <SectionRow
      onDelete={() => void onDelete(() => deleteRelationship(link.id), "Unlinked")}
      deleteLabel="Remove link"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Link href={`/people/${link.person.id}`} className="flex min-w-0 items-center gap-2">
          {link.term.icon ? (
            <Icon name={link.term.icon} className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate text-sm font-medium">{displayName(link.person)}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[11px]",
              termColorClasses(link.term.color),
            )}
          >
            {link.term.label}
          </span>
        </Link>
        {link.canEnd ? (
          <button
            type="button"
            onClick={() => setEnding((v) => !v)}
            aria-expanded={ending}
            // Named per person: a column of identical "Ended" buttons tells a
            // screen-reader user nothing about which relationship they end.
            aria-label={
              ending
                ? `Cancel ending ${link.term.label} with ${displayName(link.person)}`
                : `${link.term.label} with ${displayName(link.person)} has ended`
            }
            className="ml-auto shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {ending ? "Cancel" : "Ended"}
          </button>
        ) : null}
      </div>

      {link.notes ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{link.notes}</p>
      ) : null}

      {ending ? (
        <form
          action={add(endRelationshipLink, () => setEnding(false), "Marked as ended")}
          className="mt-2 grid gap-2"
        >
          <input type="hidden" name="id" value={link.id} />
          <p className="text-xs text-muted-foreground">
            Keeps {displayName(link.person)} and everything recorded about them — only the
            relationship is re-labelled.
          </p>
          <Field label="Note (optional)" htmlFor={`ended-${link.id}`}>
            <Input
              id={`ended-${link.id}`}
              name="notes"
              placeholder="Divorced 2021, still co-parenting."
            />
          </Field>
          <SubmitButton size="sm">{`Mark as ended`}</SubmitButton>
        </form>
      ) : null}
    </SectionRow>
  );
}

/** The households a contact belongs to, and a way in and out of them. */
export function ContactHouseholdsSection({
  contactId,
  households,
  allHouseholds,
}: {
  contactId: string;
  households: HouseholdItem[];
  /** Every household, so someone can be added to one that exists already. */
  allHouseholds: Array<{ id: string; name: string }>;
}) {
  const run = useAction();
  const add = useAddAction();
  const joinable = allHouseholds.filter((h) => !households.some((mine) => mine.id === h.id));

  return (
    <SectionCard
      title="Households"
      icon="Users"
      count={households.length}
      addLabel="Add to a household"
      defaultOpen={households.length > 0}
      form={(close) => (
        <form action={add(addHouseholdMember, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          {joinable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other households yet — create one on the{" "}
              <Link href="/family" className="underline">
                Family
              </Link>{" "}
              page.
            </p>
          ) : (
            <>
              <Field label="Household" htmlFor="household-pick">
                <select
                  id="household-pick"
                  name="householdId"
                  required
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                >
                  {joinable.map((household) => (
                    <option key={household.id} value={household.id}>
                      {household.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Their role there (optional)" htmlFor="household-role">
                <Input id="household-role" name="role" placeholder="Mum" />
              </Field>
              <SubmitButton size="sm">Add</SubmitButton>
            </>
          )}
        </form>
      )}
    >
      {households.length === 0 ? (
        <SectionEmpty>Not in a household.</SectionEmpty>
      ) : (
        households.map((household) => (
          <SectionRow
            key={household.id}
            onDelete={() =>
              void run(() => removeHouseholdMember(household.id, contactId), "Removed")
            }
            deleteLabel={`Remove from ${household.name}`}
          >
            <Link href="/family" className="truncate text-sm font-medium hover:underline">
              {household.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {household.members.map((m) => displayName(m.person)).join(" · ")}
            </p>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
