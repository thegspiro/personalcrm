"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import { clearPostalCodes, importPostalCodes } from "@/server/actions/postal-codes";

export interface PostalSourceView {
  country: string;
  rows: number;
  /** Serialised before it crosses: a `Date` does not survive the boundary. */
  importedAt: string;
}

/**
 * Importing a country's postal codes.
 *
 * Nothing is fetched, and that is the point rather than a limitation: the
 * operator downloads the file from GeoNames and uploads it, so an installation
 * with no outbound network at all can still fill in a city from a postal code.
 * It is also why there is no country list to pick from — the file says which
 * country it holds, and being told is better than being asked.
 *
 * Administrator-only for the same reason the address lookup's endpoint is: this
 * is stored per installation, not per account, so one member's import is
 * everybody's.
 */
export function PostalCodeSettings({
  sources,
  canEdit,
}: {
  sources: PostalSourceView[];
  canEdit: boolean;
}) {
  const run = useAction();
  const save = useAddAction();
  const [note, setNote] = React.useState<string>();
  /**
   * Bumped after an import, to remount the file input.
   *
   * A file input keeps its selection across the refresh, so without this the
   * file that was just imported sits there looking as though it is queued to
   * import again. Remounting by `key` rather than reaching for the element,
   * the same way the geo panel re-keys its endpoint field.
   */
  const [imports, setImports] = React.useState(0);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Postal codes</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Import a country&apos;s postal codes and an address can fill in its city
          and state from the code — with nothing sent anywhere, because the data is already
          here. Download a country from{" "}
          <a
            href="https://download.geonames.org/export/zip/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-11 hover:underline"
          >
            GeoNames
          </a>
          , unzip it, and upload the <code>.txt</code>.
        </p>
      </div>

      {!canEdit ? (
        <p className="mt-3 text-xs text-muted-foreground">
          These are shared by everyone using this installation, so only an administrator can
          change them.
        </p>
      ) : null}

      <fieldset disabled={!canEdit} className="contents">
        <form
          action={save(
            async (form) => {
              const result = await importPostalCodes(form);
              if (result.ok && result.data) {
                const { country, rows, skipped } = result.data as {
                  country: string;
                  rows: number;
                  skipped: number;
                };
                setNote(
                  `Imported ${rows.toLocaleString("en-US")} postal codes for ${country}` +
                    (skipped > 0
                      ? `. ${skipped.toLocaleString("en-US")} line(s) could not be read and were left out.`
                      : "."),
                );
                setImports((count) => count + 1);
              }
              return result;
            },
            () => {},
            "Imported",
          )}
          className="mt-3 grid gap-2.5 border-t border-border/70 pt-3"
        >
          <Field
            label="Country file"
            htmlFor="postal-file"
            hint="One country at a time — US.txt, GB.txt. Not allCountries.txt."
          >
            <Input
              key={imports}
              id="postal-file"
              name="file"
              type="file"
              accept=".txt,text/plain"
            />
          </Field>
          <div>
            <SubmitButton size="sm">Import</SubmitButton>
          </div>
        </form>
      </fieldset>

      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}

      {sources.length > 0 ? (
        <ul className="mt-3 grid gap-1.5 border-t border-border/70 pt-3">
          {sources.map((source) => (
            <li
              key={source.country}
              className="flex min-w-0 items-center justify-between gap-3 text-xs"
            >
              <span className="min-w-0">
                <strong>{source.country}</strong> — {source.rows.toLocaleString("en-US")} codes,
                imported {source.importedAt}
              </span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${source.country} postal codes`}
                  onClick={() => {
                    const form = new FormData();
                    form.set("country", source.country);
                    void run(() => clearPostalCodes(form), "Removed");
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          No postal codes imported. Address fields behave exactly as they do now.
        </p>
      )}

      {/*
        A licence condition rather than a courtesy: the data is published under
        CC BY 4.0, which requires crediting its source wherever it is used.
      */}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Postal code data from{" "}
        <a
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:underline"
        >
          GeoNames
        </a>
        , used under{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:underline"
        >
          CC BY 4.0
        </a>
        .
      </p>
    </section>
  );
}
