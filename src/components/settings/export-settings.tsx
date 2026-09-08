"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportAccount, type ExportFormat } from "@/server/actions/export";

interface FormatOption {
  id: ExportFormat;
  label: string;
  description: string;
}

const FORMATS: FormatOption[] = [
  {
    id: "json",
    label: "Everything, as JSON",
    description:
      "The complete account — people, history, dates, plans, your own field and type definitions. The one to keep if you keep only one.",
  },
  {
    id: "csv",
    label: "Contacts, as a spreadsheet",
    description:
      "One row per person, flattened. Convenient to look at; it cannot hold your history, so it is not a backup.",
  },
  {
    id: "vcard",
    label: "Contacts, as vCard",
    description:
      "For a phone or address book. Birthdays keep whatever accuracy you recorded — a date with no year stays a date with no year.",
  },
  {
    id: "ics",
    label: "Dates, as a calendar",
    description:
      "Birthdays and important dates as recurring all-day events, for any calendar app.",
  },
];

/**
 * Getting your data out.
 *
 * The file is built by the server action and saved here rather than fetched
 * from a URL. Route handlers are kept to the few that genuinely cannot be
 * server actions — the healthcheck, the authenticated avatar read, and the
 * calendar subscription, which is fetched by a calendar client rather than by
 * this app. Assembling the download in the browser adds none, and keeps the
 * export out of the service worker's fetch handling entirely.
 */
export function ExportSettings({ locked }: { locked: boolean }) {
  const [busy, setBusy] = React.useState<ExportFormat | null>(null);

  async function download(format: ExportFormat) {
    setBusy(format);
    try {
      const result = await exportAccount(format);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "The export could not be produced.");
        return;
      }

      const { filename, mimeType, content } = result.data;
      const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Released on the next tick rather than immediately: revoking while the
      // click is still being handled cancels the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Saved ${filename}`);
    } catch (error) {
      // A server action can reject rather than return — a dropped database
      // connection, a restart mid-request. Without this the promise rejects
      // into nothing, the button simply stops spinning, and the download looks
      // like it silently did not happen.
      console.error("Export failed", error);
      toast.error("The export could not be produced.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Export</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Your data, in formats other things can read. Nothing leaves the machine except by
          being saved where you tell your browser to put it.
        </p>
      </div>

      {locked ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Some of your data is hidden while the privacy lock is closed. Exporting now would
          produce a file that looks complete without being it, so unlock first.
        </p>
      ) : null}

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {FORMATS.map((format) => (
          <li
            key={format.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{format.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{format.description}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === format.id}
              disabled={busy !== null}
              onClick={() => void download(format.id)}
            >
              <Download />
              Download
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
