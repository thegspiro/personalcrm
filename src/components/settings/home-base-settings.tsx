"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAddAction } from "@/components/form/use-action";
import { PlaceLookup } from "@/components/locations/place-lookup";
import { lookupHomeBase, updateHomeBase } from "@/server/actions/settings";
import type { GeoCandidateView } from "@/server/geo/providers";

export interface HomeBaseSettingsProps {
  homeAddress: string | null;
  homeCity: string | null;
  homeRegion: string | null;
  homeCountry: string | null;
  /** Serialised: `Decimal` does not survive the crossing to a client component. */
  homeLatitude: string | null;
  homeLongitude: string | null;
  distanceUnit: string;
  /** Whether the installation has address lookup switched on at all. */
  lookupEnabled: boolean;
}

/**
 * Where you are, so the app can say how far away something is.
 *
 * Entirely optional, and nothing is inferred: an account that leaves this blank
 * never sees a distance anywhere, which is exactly how every installation reads
 * the day it upgrades. Only the coordinates are load-bearing — the address
 * lines are there so the lookup has something to search and so the row is
 * recognisable later.
 */
export function HomeBaseSettings({
  homeAddress,
  homeCity,
  homeRegion,
  homeCountry,
  homeLatitude,
  homeLongitude,
  distanceUnit,
  lookupEnabled,
}: HomeBaseSettingsProps) {
  const save = useAddAction();
  const [address, setAddress] = React.useState(homeAddress ?? "");
  const [city, setCity] = React.useState(homeCity ?? "");
  const [region, setRegion] = React.useState(homeRegion ?? "");
  const [country, setCountry] = React.useState(homeCountry ?? "");
  const [latitude, setLatitude] = React.useState(homeLatitude ?? "");
  const [longitude, setLongitude] = React.useState(homeLongitude ?? "");

  function buildQuery() {
    return [address, city, region, country]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");
  }

  function runLookup(query: string) {
    const form = new FormData();
    form.set("query", query);
    return lookupHomeBase(form);
  }

  function accept(candidate: GeoCandidateView) {
    if (candidate.address) setAddress(candidate.address);
    if (candidate.city) setCity(candidate.city);
    if (candidate.region) setRegion(candidate.region);
    if (candidate.country) setCountry(candidate.country);
    setLatitude(candidate.latitude ?? "");
    setLongitude(candidate.longitude ?? "");
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Home base</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Set this and plans and places can say how far away they are,
          and a person&apos;s page can suggest somewhere near them. Only the
          coordinates are used; nothing is shown to anyone but you, and nothing
          is sent anywhere unless you press the lookup button.
        </p>
      </div>

      <form action={save(updateHomeBase, () => {}, "Saved")} className="mt-3 grid gap-2.5">
        <Field label="Address" htmlFor="home-address">
          <Input
            id="home-address"
            name="homeAddress"
            maxLength={500}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="14 Ashfield Road"
          />
        </Field>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="City" htmlFor="home-city">
            <Input
              id="home-city"
              name="homeCity"
              maxLength={120}
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label="Region" htmlFor="home-region">
            <Input
              id="home-region"
              name="homeRegion"
              maxLength={120}
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
          </Field>
          <Field label="Country" htmlFor="home-country">
            <Input
              id="home-country"
              name="homeCountry"
              maxLength={120}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            />
          </Field>
        </div>

        {lookupEnabled ? (
          <PlaceLookup
            buildQuery={buildQuery}
            search={runLookup}
            onAccept={accept}
            idleLabel="Look up my address"
          />
        ) : null}

        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="Latitude" htmlFor="home-latitude">
            <Input
              id="home-latitude"
              name="homeLatitude"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="51.5072"
            />
          </Field>
          <Field label="Longitude" htmlFor="home-longitude">
            <Input
              id="home-longitude"
              name="homeLongitude"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="-0.1276"
            />
          </Field>
          <Field label="Distances in" htmlFor="home-unit">
            <select
              id="home-unit"
              name="distanceUnit"
              defaultValue={distanceUnit}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="mi">Miles</option>
              <option value="km">Kilometres</option>
            </select>
          </Field>
        </div>

        <SubmitButton size="sm" className="justify-self-start">
          Save
        </SubmitButton>
      </form>
    </section>
  );
}
