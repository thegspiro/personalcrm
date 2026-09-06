"use client";

import * as React from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";
import {
  commitImport,
  previewImport,
  type ImportFormat,
  type ImportPreview,
} from "@/server/actions/import";

/**
 * Bringing contacts in.
 *
 * Two steps, always. The file is read and described first, and nothing is
 * written until somebody has looked at what would happen — because the one
 * mistake an import cannot take back is merging two people who turn out to be
 * different, and the second worst is a few hundred duplicates nobody asked
 * for. Rows that look like somebody already here are unticked by default: the
 * safe answer is the one that requires no attention.
 */
export function ImportSettings({ locked }: { locked: boolean }) {
  const router = useRouter();
  const [format, setFormat] = React.useState<ImportFormat>("vcard");
  const [text, setText] = React.useState<string | null>(null);
  const [filename, setFilename] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [skip, setSkip] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setText(null);
    setFilename(null);
    setPreview(null);
    setSkip(new Set());
  }

  async function choose(file: File) {
    const chosen: ImportFormat = file.name.toLowerCase().endsWith(".csv") ? "csv" : "vcard";
    setBusy(true);
    try {
      const contents = await file.text();
      const result = await previewImport(chosen, contents);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "That file could not be read.");
        reset();
        return;
      }
      setFormat(chosen);
      setText(contents);
      setFilename(file.name);
      setPreview(result.data);
      // Anything that looks like a repeat starts unticked, so doing nothing is
      // the cautious choice rather than the careless one.
      setSkip(
        new Set(
          result.data.rows
            .filter((row) => row.problem || row.duplicate || row.repeatedInFile)
            .map((row) => row.index),
        ),
      );
    } catch (error) {
      // Reading the file or the preview action can reject rather than return —
      // a dropped connection, a restart mid-request. Without this the promise
      // rejects into nothing and the panel just stops, with no preview and no
      // reason given.
      console.error("Reading the file failed", error);
      toast.error("That file could not be read.");
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!text || !preview) return;
    setBusy(true);
    try {
      const result = await commitImport(format, text, [...skip]);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "The import did not run.");
        return;
      }
      toast.success(
        `Added ${result.data.created} ${result.data.created === 1 ? "person" : "people"}.`,
      );
      reset();
      router.refresh();
    } catch (error) {
      // As above: a rejected action would otherwise stop the button spinning
      // and say nothing, leaving it unclear whether anything was written.
      console.error("Import failed", error);
      toast.error("The import did not run.");
    } finally {
      setBusy(false);
    }
  }

  const selected = preview ? preview.rows.filter((row) => !skip.has(row.index) && !row.problem) : [];

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Import</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A <code>.vcf</code> from a phone or address book, or a <code>.csv</code> from a
          spreadsheet. You will see what it contains before anything is added.
        </p>
      </div>

      {locked ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Some of your contacts are hidden while the privacy lock is closed, so an import could
          not tell whether somebody in the file is already here. Unlock first.
        </p>
      ) : (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50">
          <Upload className="size-4" />
          {filename ?? "Choose a file"}
          <input
            type="file"
            accept=".vcf,.vcard,.csv,text/vcard,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              event.target.value = "";
              if (file) void choose(file);
            }}
          />
        </label>
      )}

      {preview ? (
        <div className="grid min-w-0 gap-3">
          <p className="text-xs text-muted-foreground">
            {preview.rows.length} {preview.rows.length === 1 ? "entry" : "entries"} read.{" "}
            {preview.duplicates > 0
              ? `${preview.duplicates} look like someone already here and are unticked. `
              : ""}
            {preview.problems > 0 ? `${preview.problems} cannot be read. ` : ""}
          </p>

          <ul className="grid max-h-80 grid-cols-[minmax(0,1fr)] gap-1 overflow-y-auto">
            {preview.rows.map((row) => (
              <li
                key={row.index}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-border px-3 py-2"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!skip.has(row.index) && !row.problem}
                  disabled={Boolean(row.problem)}
                  onCheckedChange={(checked) =>
                    setSkip((current) => {
                      const next = new Set(current);
                      if (checked) next.delete(row.index);
                      else next.add(row.index);
                      return next;
                    })
                  }
                  aria-label={`Import ${row.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.email, row.detail].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {row.problem ? (
                    <p className="mt-0.5 text-xs text-destructive">{row.problem}</p>
                  ) : null}
                  {row.duplicate ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Looks like {row.duplicate.name}, already here
                      {row.duplicate.reason === "email"
                        ? " — same email address"
                        : " — same name, which families share"}
                      .
                    </p>
                  ) : null}
                  {row.repeatedInFile ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Appears earlier in this same file.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={busy} disabled={selected.length === 0} onClick={() => void run()}>
              Import {selected.length} {selected.length === 1 ? "person" : "people"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
