"use client";

import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import {
  createAddress,
  deleteAddress,
  updateAddress,
} from "@/server/actions/details";

export interface AddressItem {
  id: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
}

/**
 * Suggestions rather than a taxonomy.
 *
 * An `ADDRESS_TYPE` kind would mean an enum migration on `TaxonomyKind` plus
 * defaults, a usage count and an admin group — to replace a free-text field
 * whose realistic values are the two below.
 */
const LABEL_SUGGESTIONS = ["Home", "Work", "Parents", "Holiday"];

function AddressFields({
  formId,
  address,
}: {
  formId: string;
  address?: AddressItem;
}) {
  return (
    <>
      <Field label="Label (optional)" htmlFor={`${formId}-label`}>
        <Input
          id={`${formId}-label`}
          name="label"
          maxLength={96}
          list={`${formId}-label-options`}
          defaultValue={address?.label ?? ""}
          placeholder="Home"
        />
        <datalist id={`${formId}-label-options`}>
          {LABEL_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </Field>
      <Field label="Address" htmlFor={`${formId}-line1`}>
        <Input
          id={`${formId}-line1`}
          name="line1"
          maxLength={191}
          defaultValue={address?.line1 ?? ""}
          placeholder="14 Ashfield Road"
        />
      </Field>
      <Field label="Line 2 (optional)" htmlFor={`${formId}-line2`}>
        <Input
          id={`${formId}-line2`}
          name="line2"
          maxLength={191}
          defaultValue={address?.line2 ?? ""}
        />
      </Field>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="City" htmlFor={`${formId}-city`}>
          <Input
            id={`${formId}-city`}
            name="city"
            maxLength={120}
            defaultValue={address?.city ?? ""}
          />
        </Field>
        <Field label="Region" htmlFor={`${formId}-region`}>
          <Input
            id={`${formId}-region`}
            name="region"
            maxLength={120}
            defaultValue={address?.region ?? ""}
          />
        </Field>
        <Field label="Postal code" htmlFor={`${formId}-postalCode`}>
          <Input
            id={`${formId}-postalCode`}
            name="postalCode"
            maxLength={32}
            defaultValue={address?.postalCode ?? ""}
          />
        </Field>
        <Field label="Country" htmlFor={`${formId}-country`}>
          <Input
            id={`${formId}-country`}
            name="country"
            maxLength={120}
            defaultValue={address?.country ?? ""}
          />
        </Field>
      </div>
      <Field label="Notes (optional)" htmlFor={`${formId}-notes`}>
        <Textarea
          id={`${formId}-notes`}
          name="notes"
          rows={2}
          defaultValue={address?.notes ?? ""}
          placeholder="Buzzer is broken — call from outside."
        />
      </Field>
    </>
  );
}

/** The parts that have something in them, in the order an envelope wants them. */
function addressLines(address: AddressItem): string[] {
  const region = [address.city, address.region, address.postalCode]
    .filter(Boolean)
    .join(", ");
  return [address.line1, address.line2, region, address.country].filter(
    (line): line is string => Boolean(line),
  );
}

function AddressRow({ address }: { address: AddressItem }) {
  const run = useAction();
  const add = useAddAction();

  return (
    <SectionRow
      onDelete={() => void run(() => deleteAddress(address.id), "Removed")}
      deleteLabel={`Remove ${address.label ?? "address"}`}
      editLabel={`Edit ${address.label ?? "address"}`}
      editForm={(close) => (
        <form
          action={add(updateAddress, close, "Saved")}
          className="grid gap-2.5"
        >
          <input type="hidden" name="id" value={address.id} />
          <AddressFields formId={`address-${address.id}`} address={address} />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
      )}
    >
      {address.label ? (
        <span className="text-sm font-medium">{address.label}</span>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {addressLines(address).map((line) => (
          <span key={line} className="block truncate">
            {line}
          </span>
        ))}
      </p>
      {address.notes ? (
        <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
          {address.notes}
        </p>
      ) : null}
    </SectionRow>
  );
}

export function AddressesSection({
  contactId,
  addresses,
}: {
  contactId: string;
  addresses: AddressItem[];
}) {
  const add = useAddAction();

  return (
    <SectionCard
      title="Where they are"
      icon="MapPin"
      count={addresses.length}
      addLabel="Add an address"
      defaultOpen={addresses.length > 0}
      form={(close) => (
        <form
          action={add(createAddress, close, "Added")}
          className="grid gap-2.5"
        >
          <input type="hidden" name="contactId" value={contactId} />
          <AddressFields formId="address-new" />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {addresses.length === 0 ? (
        <SectionEmpty>No address recorded.</SectionEmpty>
      ) : (
        addresses.map((address) => (
          <AddressRow key={address.id} address={address} />
        ))
      )}
    </SectionCard>
  );
}
