"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import {
  createAddress,
  deleteAddress,
  lookupContactAddress,
  updateAddress,
} from "@/server/actions/details";
import { PlaceLookup } from "@/components/locations/place-lookup";
import type { GeoCandidateView } from "@/server/geo/providers";
import { mapLinkFor } from "@/lib/locations";

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
  /**
   * Serialised before it crosses from the page, because `osmId` is a `BIGINT`
   * and neither `BigInt` nor `Decimal` survives the boundary into a client
   * component — it throws at render rather than arriving wrong.
   */
  latitude: string | null;
  longitude: string | null;
  osmType: string | null;
  osmId: string | null;
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
  contactId,
  address,
  lookupEnabled,
  isPrivate,
}: {
  formId: string;
  contactId: string;
  address?: AddressItem;
  lookupEnabled: boolean;
  /** A private contact's address is never sent anywhere. See below. */
  isPrivate: boolean;
}) {
  const [applied, setApplied] = React.useState<GeoCandidateView | null>(null);
  const [city, setCity] = React.useState(address?.city ?? "");
  const [region, setRegion] = React.useState(address?.region ?? "");
  const [country, setCountry] = React.useState(address?.country ?? "");
  const [latitude, setLatitude] = React.useState(address?.latitude ?? "");
  const [longitude, setLongitude] = React.useState(address?.longitude ?? "");
  // The street lines stay uncontrolled — they are the only fields a lookup does
  // not write back — so the query reads them through refs.
  const line1Ref = React.useRef<HTMLInputElement>(null);
  const line2Ref = React.useRef<HTMLInputElement>(null);

  // A private contact's address is never sent anywhere, whatever the toggle
  // says. The action refuses it too — this only keeps the button from offering
  // something that would be turned down.
  const canLookUp = lookupEnabled && !isPrivate;

  // Only the address itself — the lines, the city, the region, the country.
  // Never the label, never the notes, and never the name of the person who
  // lives there.
  function buildQuery() {
    return [
      line1Ref.current?.value,
      line2Ref.current?.value,
      city,
      region,
      country,
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");
  }

  function runLookup(query: string) {
    const form = new FormData();
    form.set("contactId", contactId);
    form.set("query", query);
    return lookupContactAddress(form);
  }

  function accept(candidate: GeoCandidateView) {
    setApplied(candidate);
    if (candidate.city) setCity(candidate.city);
    if (candidate.region) setRegion(candidate.region);
    if (candidate.country) setCountry(candidate.country);
    // Shown rather than hidden, so a match that landed a continent away is
    // visible and correctable before Save rather than after.
    setLatitude(candidate.latitude ?? "");
    setLongitude(candidate.longitude ?? "");
  }

  /**
   * The OSM object this address is still pointing at.
   *
   * A fresh match brings its own. Otherwise the saved one is kept only while
   * the coordinates are the ones it came with: edit them by hand and the
   * reference no longer describes this spot, and `mapLinkFor` prefers it — so
   * keeping it would open the venue the address used to be.
   */
  const osmReference =
    applied ??
    (latitude === (address?.latitude ?? "") && longitude === (address?.longitude ?? "")
      ? address ?? null
      : null);

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
          ref={line1Ref}
          maxLength={191}
          defaultValue={address?.line1 ?? ""}
          placeholder="14 Ashfield Road"
        />
      </Field>
      <Field label="Line 2 (optional)" htmlFor={`${formId}-line2`}>
        <Input
          id={`${formId}-line2`}
          name="line2"
          ref={line2Ref}
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
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </Field>
        <Field label="Region" htmlFor={`${formId}-region`}>
          <Input
            id={`${formId}-region`}
            name="region"
            maxLength={120}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
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
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          />
        </Field>
      </div>

      {/*
        Placing an address is what lets the app answer "somewhere near her?".
        A private contact never gets the lookup — the rule the AI layer already
        follows, that nothing touching a private person leaves the machine
        whatever the toggle says, and a home address identifies someone more
        precisely than a name does. The coordinate fields below are the way in
        for them, and the way to correct a bad match for anyone else.
      */}
      {canLookUp ? (
        <PlaceLookup buildQuery={buildQuery} search={runLookup} onAccept={accept} />
      ) : null}

      {osmReference?.osmType ? (
        <input type="hidden" name="osmType" value={osmReference.osmType} />
      ) : null}
      {osmReference?.osmType && osmReference.osmId ? (
        <input type="hidden" name="osmId" value={osmReference.osmId} />
      ) : null}
      {applied ? (
        <p className="text-xs text-muted-foreground">
          Matched to <strong>{applied.label}</strong>. Save to keep it.
        </p>
      ) : null}

      {/*
        Open when there is no lookup button above it, because then typing the
        pair is the only way to place this address at all — which is always the
        case for a private contact, whose address is never sent anywhere. Left
        folded away when the button is there, since that is the easier route
        and most people will take it.
      */}
      <details className="text-xs" open={Boolean(latitude || longitude) || !canLookUp}>
        <summary className="cursor-pointer text-muted-foreground">
          Coordinates (optional)
        </summary>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <Field label="Latitude" htmlFor={`${formId}-latitude`}>
            <Input
              id={`${formId}-latitude`}
              name="latitude"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="51.5072"
            />
          </Field>
          <Field label="Longitude" htmlFor={`${formId}-longitude`}>
            <Input
              id={`${formId}-longitude`}
              name="longitude"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="-0.1276"
            />
          </Field>
        </div>
      </details>
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

function AddressRow({
  address,
  contactId,
  lookupEnabled,
  isPrivate,
}: {
  address: AddressItem;
  contactId: string;
  lookupEnabled: boolean;
  isPrivate: boolean;
}) {
  const run = useAction();
  const edit = useEditAction();
  // Built from every part we hold, not just the street: "14 Ashfield Road" on
  // its own is a road in a hundred towns.
  const mapHref = mapLinkFor({
    name: address.label ?? address.line1 ?? "Address",
    address: [address.line1, address.line2].filter(Boolean).join(", ") || null,
    city: address.city,
    region: address.region,
    country: address.country,
    latitude: address.latitude,
    longitude: address.longitude,
    osmType: address.osmType,
    osmId: address.osmId,
  });

  return (
    <SectionRow
      onDelete={() => void run(() => deleteAddress(address.id), "Removed")}
      deleteLabel={`Remove ${address.label ?? "address"}`}
      editLabel={`Edit ${address.label ?? "address"}`}
      editForm={(close) => (
        <form
          action={edit(updateAddress, close, "Saved")}
          className="grid gap-2.5"
        >
          <input type="hidden" name="id" value={address.id} />
          <AddressFields
            formId={`address-${address.id}`}
            contactId={contactId}
            address={address}
            lookupEnabled={lookupEnabled}
            isPrivate={isPrivate}
          />
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
      <a
        href={mapHref}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 inline-flex items-center gap-1 text-xs text-accent-11 hover:underline"
      >
        <MapPin className="size-3" />
        {address.latitude ? "Open map" : "Find on a map"}
      </a>
    </SectionRow>
  );
}

export function AddressesSection({
  contactId,
  addresses,
  lookupEnabled,
  isPrivate,
}: {
  contactId: string;
  addresses: AddressItem[];
  /** Whether the installation has address lookup switched on at all. */
  lookupEnabled: boolean;
  isPrivate: boolean;
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
          <AddressFields
            formId="address-new"
            contactId={contactId}
            lookupEnabled={lookupEnabled}
            isPrivate={isPrivate}
          />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {addresses.length === 0 ? (
        <SectionEmpty>No address recorded.</SectionEmpty>
      ) : (
        addresses.map((address) => (
          <AddressRow
            key={address.id}
            address={address}
            contactId={contactId}
            lookupEnabled={lookupEnabled}
            isPrivate={isPrivate}
          />
        ))
      )}
    </SectionCard>
  );
}
