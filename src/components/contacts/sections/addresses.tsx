"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { lookupPostalCode } from "@/server/actions/postal-codes";
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
  postalCodes,
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
  /** Whether any postal codes have been imported to fill a city from. */
  postalCodes: boolean;
}) {
  const [applied, setApplied] = React.useState<GeoCandidateView | null>(null);
  // A place copied into this form, playing the same role a lookup match does:
  // it fills the boxes visibly and nothing is written until Save.
  const [pickedPlace, setPickedPlace] = React.useState<PlaceSuggestion | null>(null);
  // Every field is controlled, including the street lines. They used to be read
  // through refs because a lookup never wrote them back; it does now — an
  // accepted suggestion fills the street — and a suggestion that fires while
  // you type has to be able to see what you have typed.
  const [postalCode, setPostalCode] = React.useState(address?.postalCode ?? "");
  /**
   * What the imported postal codes say this code names.
   *
   * `null` until asked. An empty array is "asked, and nothing answered", which
   * is a different thing to say.
   */
  const [postalPlaces, setPostalPlaces] = React.useState<
    { country: string; place: string; region: string | null }[] | null
  >(null);
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

  /**
   * Fill the city and region in from the postal code.
   *
   * A button rather than something that happens while you type. The reason is
   * the opposite of the address lookup's: nothing here leaves the machine, so
   * there is no harm in asking — but there is no reason to overwrite a city
   * somebody has already typed without being asked to either.
   *
   * Filled only when exactly one place answers. A postal code can legitimately
   * name several, and picking one of them would be the guess that
   * `placeUnplaced` refuses to make for the same reason: a wrong city looks
   * exactly like a right one.
   */
  async function fillFromPostalCode() {
    const form = new FormData();
    form.set("code", postalCode);
    const result = await lookupPostalCode(form);
    if (!result.ok) {
      setPostalPlaces([]);
      return;
    }

    const places = result.data?.places ?? [];
    setPostalPlaces(places);
    if (places.length === 1) applyPostalPlace(places[0]);
  }

  function applyPostalPlace(match: { place: string; region: string | null }) {
    setCity(match.place);
    if (match.region) setRegion(match.region);
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
            value={postalCode}
            onChange={(event) => {
              setPostalCode(event.target.value);
              // The answer described the old code; it is no longer an answer.
              setPostalPlaces(null);
            }}
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
        Offered only where postal codes have actually been imported, so an
        installation that has imported none sees no new control at all. Nothing
        here reaches the network — the data is already on this machine, which is
        why it works for a private contact where the address lookup does not.
      */}
      {postalCodes ? (
        <div className="grid gap-2">
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!postalCode.trim()}
              onClick={() => void fillFromPostalCode()}
            >
              <MapPin className="size-3.5" />
              Fill city from postal code
            </Button>
          </div>

          {postalPlaces?.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No imported postal code matches that. Fill the city in by hand.
            </p>
          ) : null}

          {postalPlaces && postalPlaces.length > 1 ? (
            <div className="grid gap-1.5 rounded-lg border border-border p-1.5">
              <p className="px-2 text-xs text-muted-foreground">
                That code covers more than one place. Which one?
              </p>
              {postalPlaces.map((match) => (
                <button
                  key={`${match.country}-${match.place}`}
                  type="button"
                  onClick={() => {
                    applyPostalPlace(match);
                    setPostalPlaces(null);
                  }}
                  className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    {match.place}
                    {match.region ? `, ${match.region}` : ""} ({match.country})
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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
  postalCodes,
}: {
  address: AddressItem;
  contactId: string;
  lookup: LookupUi;
  isPrivate: boolean;
  places: PlaceSuggestion[];
  placesTruncated: boolean;
  postalCodes: boolean;
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
            postalCodes={postalCodes}
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
  postalCodes = false,
}: {
  contactId: string;
  addresses: AddressItem[];
  /** Whether the installation offers address lookup, and how. */
  lookup: LookupUi;
  isPrivate: boolean;
  /** Places you have already been, to copy an address from. */
  places?: PlaceSuggestion[];
  placesTruncated?: boolean;
  /** Whether any postal codes have been imported to fill a city from. */
  postalCodes?: boolean;
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
            postalCodes={postalCodes}
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
            postalCodes={postalCodes}
          />
        ))
      )}
    </SectionCard>
  );
}
