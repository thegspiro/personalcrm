"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import type { GeoProviderDefinition, GeoProviderId } from "@/server/geo/providers";
import {
  saveGeoConnection,
  updateGeoEnabled,
  updateGeoTypeahead,
} from "@/server/actions/geo-settings";

export interface GeoSettingsProps {
  enabled: boolean;
  usable: boolean;
  provider: GeoProviderId;
  baseUrl: string;
  /** Whether suggestions while typing are switched on and in effect. */
  typeahead: boolean;
  /**
   * Whether the *saved* endpoint permits search-as-you-type at all.
   *
   * Saved, not selected: the dropdown below is local state until "Save
   * connection" is pressed, and a switch that writes against the stored
   * connection must not appear or vanish because of a choice nobody has
   * committed yet.
   */
  typeaheadCapable: boolean;
  providers: GeoProviderDefinition[];
  /** The endpoint is per-installation, so only an administrator may change it. */
  canEdit: boolean;
}

/**
 * The optional address lookup.
 *
 * Framed the same way as the assisted reading: an extra, off by default, and
 * the copy says what leaves the machine before it says anything else. A place's
 * address is perfectly editable by hand without any of this.
 */
export function GeoSettings({
  enabled,
  usable,
  provider,
  baseUrl,
  typeahead,
  typeaheadCapable,
  providers,
  canEdit,
}: GeoSettingsProps) {
  const run = useAction();
  const save = useAddAction();
  const [selected, setSelected] = React.useState<GeoProviderId>(provider);

  const definition = providers.find((entry) => entry.id === selected) ?? providers[0];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Address lookup</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional. When this is on, a place&apos;s page gets a &ldquo;Look up&rdquo; button
            that fills in its address, city and coordinates from OpenStreetMap — and ties it to
            the real venue, so the map link lands on the exact spot.
          </p>
        </div>
        <Switch
          checked={enabled}
          aria-label="Use address lookup"
          disabled={!usable || !canEdit}
          onCheckedChange={(checked) =>
            void run(() => updateGeoEnabled(checked), checked ? "Turned on" : "Turned off")
          }
        />
      </div>

      {/*
        Offered only where the endpoint permits it: Nominatim's usage policy
        forbids search-as-you-type, so its switch is simply not there rather
        than there and refusing. Disabled until the lookup itself is on, since
        this decides how an address is sent rather than whether.
      */}
      {typeaheadCapable ? (
        <div className="mt-3 flex min-w-0 items-start justify-between gap-3 border-t border-border/70 pt-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Suggest addresses as I type</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The endpoint sees what you have typed each time you pause, rather than once when
              you press the button. Faster to fill in an address; more that leaves the machine.
              Off unless you ask for it.
            </p>
          </div>
          <Switch
            checked={typeahead}
            aria-label="Suggest addresses as I type"
            disabled={!enabled || !usable || !canEdit}
            onCheckedChange={(checked) =>
              void run(() => updateGeoTypeahead(checked), checked ? "Turned on" : "Turned off")
            }
          />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 border-t border-border/70 pt-3">
        <div className="rounded-lg bg-muted/60 px-3 py-2.5">
          <p className="text-xs font-medium">What gets sent, and when</p>
          <ul className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
            {typeahead ? (
              <li>
                · Each time you pause while typing an address, and when you press &ldquo;Look
                up&rdquo;. Never on a page load.
              </li>
            ) : (
              <li>
                · Only when you press &ldquo;Look up&rdquo;. Never while you type, never on a page
                load.
              </li>
            )}
            <li>· Only the place&apos;s name and whatever address you typed.</li>
            <li>
              · Never your notes, never who you saw there, never anything about an interaction.
            </li>
            <li>· Never a private person&apos;s address, whatever these switches say.</li>
            <li>· Nothing at all while this is off, which is how it ships.</li>
          </ul>
        </div>

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            This endpoint is shared by everyone using this installation, so only an administrator
            can change it.
          </p>
        ) : null}

        <fieldset disabled={!canEdit} className="contents">
        <form action={save(saveGeoConnection, () => {}, "Connection saved")} className="grid gap-2.5">
          <Field label="Provider" htmlFor="geo-provider">
            <select
              id="geo-provider"
              name="provider"
              value={selected}
              onChange={(event) => setSelected(event.target.value as GeoProviderId)}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[11px] text-muted-foreground">{definition.note}</p>

          {definition.baseUrlEditable ? (
            <Field
              label="Endpoint"
              htmlFor="geo-base"
              hint={
                definition.dialect === "photon"
                  ? "Anything that answers the Photon /api endpoint. Give the base address only — the path is added for you."
                  : "Anything that answers the Nominatim /search API. Give the base address only — the path is added for you."
              }
            >
              {/*
                Keyed on the provider so switching remounts the field. Two
                editable providers can now be chosen between, and `defaultValue`
                only applies on mount — so without this, moving from Photon to a
                self-hosted Nominatim kept the Photon URL and saved the new
                dialect against the old endpoint, which just returns nothing.
              */}
              <Input
                key={selected}
                id="geo-base"
                name="baseUrl"
                defaultValue={selected === provider ? baseUrl : definition.defaultBaseUrl}
                placeholder={definition.defaultBaseUrl}
              />
            </Field>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Endpoint: <code>{definition.defaultBaseUrl}</code>
            </p>
          )}

          <div>
            <SubmitButton size="sm">Save connection</SubmitButton>
          </div>
        </form>
        </fieldset>
      </div>
    </section>
  );
}
