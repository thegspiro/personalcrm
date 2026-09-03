"use client";

import * as React from "react";
import { Archive, MapPin, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction } from "@/components/form/use-action";
import {
  lookupLocationAddress,
  setLocationArchived,
  updateLocation,
  type GeoCandidateView,
} from "@/server/actions/locations";

export interface EditablePlace {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
  isArchived: boolean;
  locationAliases?: { value: string; isCanonical: boolean }[];
}

/**
 * Correcting a place.
 *
 * Places used to be created only as a side effect of logging something, which
 * meant a typo was permanent and every practical field was unreachable. The
 * lookup button is deliberate rather than automatic — see `src/server/geo/`.
 */
export function EditPlaceSheet({
  place,
  lookupEnabled,
}: {
  place: EditablePlace;
  lookupEnabled: boolean;
}) {
  const run = useAction();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {},
  );
  const [candidates, setCandidates] = React.useState<GeoCandidateView[] | null>(
    null,
  );
  const [looking, setLooking] = React.useState(false);
  // What a lookup filled in, held here rather than written on the spot so a
  // single Save carries it alongside anything typed by hand.
  const [applied, setApplied] = React.useState<GeoCandidateView | null>(null);
  const [address, setAddress] = React.useState(place.address ?? "");
  const [city, setCity] = React.useState(place.city ?? "");
  const [region, setRegion] = React.useState(place.region ?? "");
  const [country, setCountry] = React.useState(place.country ?? "");

  async function onSubmit(form: FormData) {
    form.set("id", place.id);
    const result = await updateLocation(form);
    if (!result.ok) {
      // Without the field errors the only message is "Please check the
      // highlighted fields" with nothing highlighted — so a rename refused
      // because the lock is closed, or because the name is taken, looked like
      // a save that simply did not work.
      setError(result.error ?? "Could not save that.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }
    setError(undefined);
    setFieldErrors({});
    setOpen(false);
    await run(async () => ({ ok: true }), "Place saved");
  }

  async function lookUp(formEl: HTMLFormElement) {
    const data = new FormData(formEl);
    const form = new FormData();
    form.set("id", place.id);
    // Only the name and whatever address is in the form. Nothing else about
    // this place — not the notes, not who was seen here — is sent anywhere.
    form.set(
      "query",
      [data.get("name"), data.get("address")].filter(Boolean).join(", "),
    );

    setLooking(true);
    const result = await lookupLocationAddress(form);
    setLooking(false);

    if (!result.ok) {
      setError(result.error ?? "That lookup didn't work.");
      return;
    }
    setError(undefined);
    setCandidates(result.data?.candidates ?? []);
  }

  function accept(candidate: GeoCandidateView) {
    // Nothing is written here. The candidate fills the form — visibly, so you
    // can see and correct it — and Save posts the whole thing at once. Writing
    // immediately and closing discarded every other edit in the panel.
    setApplied(candidate);
    if (candidate.address) setAddress(candidate.address);
    if (candidate.city) setCity(candidate.city);
    if (candidate.region) setRegion(candidate.region);
    if (candidate.country) setCountry(candidate.country);
    setCandidates(null);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" /> Edit
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit place</SheetTitle>
            <SheetDescription>
              Renaming this changes the place everywhere. Past entries keep the
              words you typed at the time.
            </SheetDescription>
          </SheetHeader>

          <form
            action={onSubmit}
            id={`edit-place-${place.id}`}
            // The sheet is a column with a scrolling body and a footer that
            // stays put; this form sits between them, so it has to be a column
            // that shrinks too. Without it the body cannot shrink, the form
            // grows past the sheet's height, and Save is clipped off the
            // bottom on a phone — visible to a test, unreachable to a thumb.
            className="flex min-h-0 flex-1 flex-col"
          >
            <SheetBody className="grid gap-3">
              <Field label="Name" htmlFor="place-name" error={fieldErrors.name}>
                <Input
                  id="place-name"
                  name="name"
                  defaultValue={place.name}
                  required
                  maxLength={191}
                />
              </Field>

              <Field label="Address" htmlFor="place-address">
                <Input
                  id="place-address"
                  name="address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  maxLength={500}
                  placeholder="123 Main St"
                />
              </Field>

              {lookupEnabled ? (
                <div className="grid gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={looking}
                    onClick={(event) => {
                      const formEl = event.currentTarget.closest("form");
                      if (formEl) void lookUp(formEl);
                    }}
                  >
                    <Search className="size-3.5" />
                    {looking ? "Looking…" : "Look up this address"}
                  </Button>

                  {candidates?.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing matched. Fill it in by hand.
                    </p>
                  ) : null}

                  {candidates?.length ? (
                    <ul className="grid gap-1.5 rounded-lg border border-border p-1.5">
                      {candidates.map((candidate, index) => (
                        <li
                          key={`${candidate.osmType}-${candidate.osmId}-${index}`}
                        >
                          <button
                            type="button"
                            onClick={() => void accept(candidate)}
                            className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                          >
                            <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent-11" />
                            <span className="min-w-0 flex-1">
                              {candidate.label}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="City" htmlFor="place-city">
                  <Input
                    id="place-city"
                    name="city"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field label="Region" htmlFor="place-region">
                  <Input
                    id="place-region"
                    name="region"
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field label="Country" htmlFor="place-country">
                  <Input
                    id="place-country"
                    name="country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    maxLength={120}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone" htmlFor="place-phone">
                  <Input
                    id="place-phone"
                    name="phone"
                    type="tel"
                    defaultValue={place.phone ?? ""}
                    maxLength={64}
                  />
                </Field>
                <Field label="Link" htmlFor="place-url">
                  <Input
                    id="place-url"
                    name="url"
                    type="url"
                    defaultValue={place.url ?? ""}
                    maxLength={500}
                  />
                </Field>
              </div>

              <Field label="Notes" htmlFor="place-notes">
                <Textarea
                  id="place-notes"
                  name="notes"
                  rows={3}
                  defaultValue={place.notes ?? ""}
                />
              </Field>

              <Field
                label="Aliases"
                htmlFor="place-aliases"
                error={fieldErrors.aliases}
              >
                <Textarea
                  id="place-aliases"
                  name="aliases"
                  rows={3}
                  defaultValue={(place.locationAliases ?? [])
                    .filter((alias) => !alias.isCanonical)
                    .map((alias) => alias.value)
                    .join("\n")}
                  placeholder="One alternate name per line"
                />
              </Field>

              {applied ? (
                <>
                  <input type="hidden" name="lookupApplied" value="1" />
                  {applied.osmType ? (
                    <input
                      type="hidden"
                      name="osmType"
                      value={applied.osmType}
                    />
                  ) : null}
                  {applied.osmId ? (
                    <input type="hidden" name="osmId" value={applied.osmId} />
                  ) : null}
                  {applied.latitude ? (
                    <input
                      type="hidden"
                      name="latitude"
                      value={applied.latitude}
                    />
                  ) : null}
                  {applied.longitude ? (
                    <input
                      type="hidden"
                      name="longitude"
                      value={applied.longitude}
                    />
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Matched to <strong>{applied.label}</strong>. Save to keep
                    it.
                  </p>
                </>
              ) : null}

              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </SheetBody>

            <SheetFooter className="flex-wrap gap-2">
              <SubmitButton>Save</SubmitButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const form = new FormData();
                  form.set("id", place.id);
                  form.set("archived", place.isArchived ? "false" : "true");
                  void run(
                    () => setLocationArchived(form),
                    place.isArchived ? "Back in the list" : "Archived",
                  ).then((done) => done && setOpen(false));
                }}
              >
                <Archive className="size-3.5" />
                {place.isArchived ? "Unarchive" : "Archive"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
