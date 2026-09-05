"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { placeUnplaced } from "@/server/actions/bulk-place";

export interface BulkPlaceSettingsProps {
  /** Lookup is on and has somewhere to ask. */
  usable: boolean;
  /**
   * True for the public OpenStreetMap service, which asks applications not to
   * geocode in bulk. The panel explains itself instead of offering a button.
   */
  publicEndpoint: boolean;
  places: number;
  addresses: number;
}

interface Progress {
  placed: number;
  skipped: number;
  remaining: number;
  done: boolean;
}

/** What a stopped pass left behind for the next press to carry on from. */
interface Resumed {
  cursor: string | null;
  placed: number;
  skipped: number;
}

const KINDS = [
  { kind: "places" as const, noun: "saved place" },
  { kind: "addresses" as const, noun: "address" },
];

/**
 * Put everything on the map in one pass.
 *
 * The loop lives here rather than on the server because the app has no job
 * queue and does not want one: each press is a bounded batch that says where it
 * got to, and this asks for the next one until there is nothing left. Closing
 * the tab stops it; pressing the button again resumes, because the cursor is
 * derived from what is still unplaced rather than remembered anywhere.
 */
export function BulkPlaceSettings({
  usable,
  publicEndpoint,
  places,
  addresses,
}: BulkPlaceSettingsProps) {
  const [running, setRunning] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<Record<string, Progress>>({});
  const [error, setError] = React.useState<string>();
  // Set when the user asks to stop, and read inside the loop so an in-flight
  // batch finishes rather than being abandoned half-written.
  const stop = React.useRef(false);
  /**
   * Where each kind got to, and what it has done, kept across presses.
   *
   * Starting from null every time looked resumable and was not: a row the
   * lookup could not match stays unplaced, so it is selected again, and ten
   * unmatchable rows at the front meant every resumed pass re-tried the same
   * ten and never reached the eleventh. Cleared when a pass runs to the end, so
   * pressing again after that starts over rather than finding nothing.
   *
   * The tallies travel with the cursor rather than beside it. Kept apart, a
   * resumed pass counted only its own segment: stopping after ten rows nobody
   * could match and then finishing two more reported "2 need a look" when the
   * true answer was twelve, which is worse than no number at all.
   */
  const resume = React.useRef<Record<string, Resumed>>({});

  if (!usable) return null;

  async function run(kind: "places" | "addresses", total: number) {
    stop.current = false;
    setRunning(kind);
    setError(undefined);
    // Picked up where the last press left off, so the running total is of the
    // whole pass rather than of this segment of it.
    const carried = resume.current[kind];
    let cursor: string | null = carried?.cursor ?? null;
    let placed = carried?.placed ?? 0;
    let skipped = carried?.skipped ?? 0;

    setProgress((current) => ({
      ...current,
      [kind]: { placed, skipped, remaining: total, done: false },
    }));

    try {
      // Bounded by the row count: every call either advances the cursor or ends
      // the pass, so this cannot spin on a row that refuses to be placed.
      for (;;) {
        const form = new FormData();
        form.set("kind", kind);
        if (cursor) form.set("cursor", cursor);

        const result = await placeUnplaced(form);
        if (!result.ok) {
          setError(result.error ?? "That didn't work.");
          break;
        }

        const data = result.data;
        if (!data) break;

        placed += data.placed;
        skipped += data.skipped;
        cursor = data.nextCursor;
        // Stored together: a cursor without its tallies is what produced the
        // misleading count above. Cleared at the end of a pass, so the next
        // press starts a fresh one rather than resuming a finished one.
        if (cursor) resume.current[kind] = { cursor, placed, skipped };
        else delete resume.current[kind];
        setProgress((current) => ({
          ...current,
          [kind]: { placed, skipped, remaining: data.remaining, done: !data.nextCursor },
        }));

        if (!data.nextCursor || stop.current) break;
      }
    } catch {
      // A server action can reject outright — a dropped connection, a deploy
      // mid-pass. Without this the panel stayed on "Placing…" for good, with
      // the button disabled and no way back but a reload.
      setError("That stopped unexpectedly. Press again to carry on where it left off.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Place everything at once</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Looks up every saved place and address that has no coordinates yet, so
          distances start working without visiting each one. Only an exact,
          single match is written — anything the lookup is unsure about is left
          for you, because a pin in the wrong city looks answered when it is not.
        </p>
      </div>

      {publicEndpoint ? (
        <p className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          Not available on the public OpenStreetMap service. It runs on donated
          hardware and its usage policy asks applications not to geocode in bulk,
          which is exactly what this would do. Point the lookup at Photon or your
          own instance above and this becomes available; the one-at-a-time button
          on each place and address works either way.
        </p>
      ) : (
        <div className="mt-3 grid gap-2.5">
          {KINDS.map(({ kind, noun }) => {
            const total = kind === "places" ? places : addresses;
            const state = progress[kind];
            const busy = running === kind;

            return (
              <div key={kind} className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={running !== null || total === 0}
                  onClick={() => void run(kind, total)}
                >
                  <MapPin className="size-3.5" />
                  {busy
                    ? "Placing…"
                    : total === 0
                      ? `No ${noun}s to place`
                      : `Place ${total} ${noun}${total === 1 ? "" : "s"}`}
                </Button>

                {state ? (
                  <span className="min-w-0 text-xs text-muted-foreground">
                    {state.placed} placed
                    {state.skipped > 0 ? `, ${state.skipped} need a look` : ""}
                    {state.done ? "" : ` — ${state.remaining} to go`}
                  </span>
                ) : null}

                {busy ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      stop.current = true;
                    }}
                  >
                    Stop
                  </Button>
                ) : null}
              </div>
            );
          })}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
