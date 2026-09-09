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
import { usePlaceLookup } from "@/components/locations/place-lookup";
import { LOCALITY_LIST_IDS } from "@/components/form/locality-options";
import { PlacePicker, type PlaceSuggestion } from "@/components/form/place-picker";
import type { GeoCandidateView, LookupUi } from "@/server/geo/providers";
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
const LABEL_SUGGESTIONS = ["Home", "Work", "Parents", "Vacation"];

function AddressFields({
  formId,
  contactId,
  address,
  lookup,
  isPrivate,
  places,
  placesTruncated,
}: {
  formId: string;
  contactId: string;
  address?: AddressItem;
  lookup: LookupUi;
  /** A private contact's address is never sent anywhere. See below. */
  isPrivate: boolean;
  /** Places you have already been, to copy an address from. */
  places: PlaceSuggestion[];
  placesTruncated: boolean;
}) {
  const [applied, setApplied] = React.useState<GeoCandidateView | null>(null);
  // A place copied into this form, playing the same role a lookup match does:
  // it fills the boxes visibly and nothing is written until Save.
  const [pickedPlace, setPickedPlace] = React.useState<PlaceSuggestion | null>(null);
  // Every field is controlled, including the street lines. They used to be read
  // through refs because a lookup never wrote them back; it does now — an
  // accepted suggestion fills the street — and a suggestion that fires while
  // you type has to be able to see what you have typed.
  const [line1, setLine1] = React.useState(address?.line1 ?? "");
  const [line2, setLine2] = React.useState(address?.line2 ?? "");
  const [city, setCity] = React.useState(address?.city ?? "");
  const [region, setRegion] = React.useState(address?.region ?? "");
  const [country, setCountry] = React.useState(address?.country ?? "");
  const [latitude, setLatitude] = React.useState(address?.latitude ?? "");
  const [longitude, setLongitude] = React.useState(address?.longitude ?? "");

  // A private contact's address is never sent anywhere, whatever the toggle
  // says. The action refuses it too — this only keeps the button from offering
  // something that would be turned down.
  const canLookUp = lookup.enabled && !isPrivate;

  // Only the address itself — the lines, the city, the region, the country.
  // Never the label, never the notes, and never the name of the person who
  // lives there. One value rather than a function, so that what the field says
  // it will send and what it sends are the same string.
  const query = React.useMemo(
    () =>
      [line1, line2, city, region, country]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", "),
    [line1, line2, city, region, country],
  );

  function runLookup(text: string, options?: { interactive?: boolean }) {
    const form = new FormData();
    form.set("contactId", contactId);
    form.set("query", text);
    if (options?.interactive) form.set("interactive", "1");
    return lookupContactAddress(form);
  }

  function accept(candidate: GeoCandidateView) {
    setApplied(candidate);
    // Only when the match actually carries one: what the user typed is better
    // than a display name that runs from the house number to the country.
    if (candidate.street) setLine1(candidate.street);
    if (candidate.city) setCity(candidate.city);
    if (candidate.region) setRegion(candidate.region);
    if (candidate.country) setCountry(candidate.country);
    // Shown rather than hidden, so a match that landed a continent away is
    // visible and correctable before Save rather than after.
    setLatitude(candidate.latitude ?? "");
    setLongitude(candidate.longitude ?? "");
  }

  /**
   * Copy a place you have been into this address.
   *
   * Copied, never linked. An `Address` hangs off one contact and cascades with
   * them, while a `Location` is owner-scoped and shared by everything that
   * happened there — a relation between the two would let deleting a person
   * take a place down with them. They also mean different things: an address is
   * where somebody *is*, a place is somewhere you *went*.
   *
   * `Location.address` is one line and is copied to `line1` whole. It is not
   * split on commas: the comma in "12 High Street, Flat 2" is not reliably a
   * line break, and a wrong guess is worse than one long line. Nothing already
   * typed is cleared — a place carries no label, no second line and no postal
   * code, so those keep whatever they hold.
   */
  function copyPlace(place: PlaceSuggestion) {
    setPickedPlace(place);
    if (place.address) setLine1(place.address);
    if (place.city) setCity(place.city);
    if (place.region) setRegion(place.region);
    if (place.country) setCountry(place.country);
    setLatitude(place.latitude ?? "");
    setLongitude(place.longitude ?? "");
  }

  /**
   * Whether a source's OSM reference still describes what is in the boxes.
   *
   * Edit the coordinates by hand and it does not: `mapLinkFor` prefers the id,
   * so keeping it would open the venue this address used to be.
   *
   * Applied to the lookup match as well as the saved row and the copied place.
   * It used to guard only the saved row, which left the same stale-id bug
   * reachable by accepting a match and then correcting its coordinates — the
   * one case where someone has just told you the match was wrong.
   */
  function stillDescribes(
    source: { latitude: string | null; longitude: string | null } | null | undefined,
  ) {
    if (!source) return false;
    return latitude === (source.latitude ?? "") && longitude === (source.longitude ?? "");
  }

  const placeLookup = usePlaceLookup({
    enabled: canLookUp,
    lookup,
    query,
    search: runLookup,
    onAccept: accept,
    listId: `${formId}-suggestions`,
  });

  const osmReference = stillDescribes(applied)
    ? applied
    : stillDescribes(pickedPlace)
      ? pickedPlace
      : stillDescribes(address)
        ? address ?? null
        : null;

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
          value={line1}
          onChange={(event) => setLine1(event.target.value)}
          placeholder="120 Maple Street"
          {...placeLookup.inputProps}
        />
        {placeLookup.suggestions}
      </Field>
      <Field label="Line 2 (optional)" htmlFor={`${formId}-line2`}>
        <Input
          id={`${formId}-line2`}
          name="line2"
          maxLength={191}
          value={line2}
          onChange={(event) => setLine2(event.target.value)}
        />
      </Field>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="City" htmlFor={`${formId}-city`}>
          <Input
            id={`${formId}-city`}
            name="city"
            list={LOCALITY_LIST_IDS.city}
            maxLength={120}
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </Field>
        <Field label="State" htmlFor={`${formId}-region`}>
          <Input
            id={`${formId}-region`}
            name="region"
            list={LOCALITY_LIST_IDS.region}
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
            list={LOCALITY_LIST_IDS.country}
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
      {placeLookup.panel}

      {/*
        Gated on having places rather than on `canLookUp`. The list is already
        privacy-filtered and nothing leaves the machine, so unlike the lookup
        this is safe for a private contact — who otherwise has no assisted way
        to fill an address at all.
      */}
      <PlacePicker
        places={places}
        truncated={placesTruncated}
        summary="Copy from a place you've been"
        onPick={copyPlace}
      />
      {pickedPlace ? (
        <p className="text-xs text-muted-foreground">
          Copied from <strong>{pickedPlace.name}</strong>. Save to keep it.
        </p>
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
  lookup,
  isPrivate,
  places,
  placesTruncated,
}: {
  address: AddressItem;
  contactId: string;
  lookup: LookupUi;
  isPrivate: boolean;
  places: PlaceSuggestion[];
  placesTruncated: boolean;
}) {
  const run = useAction();
  const edit = useEditAction();
  // Built from every part we hold, not just the street: "120 Maple Street" on
  // its own is a street in a hundred towns.
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
            lookup={lookup}
            isPrivate={isPrivate}
            places={places}
            placesTruncated={placesTruncated}
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
  lookup,
  isPrivate,
  places = [],
  placesTruncated = false,
}: {
  contactId: string;
  addresses: AddressItem[];
  /** Whether the installation offers address lookup, and how. */
  lookup: LookupUi;
  isPrivate: boolean;
  /** Places you have already been, to copy an address from. */
  places?: PlaceSuggestion[];
  placesTruncated?: boolean;
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
            lookup={lookup}
            isPrivate={isPrivate}
            places={places}
            placesTruncated={placesTruncated}
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
            lookup={lookup}
            isPrivate={isPrivate}
            places={places}
            placesTruncated={placesTruncated}
          />
        ))
      )}
    </SectionCard>
  );
}
