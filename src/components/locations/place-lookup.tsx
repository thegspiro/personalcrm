"use client";

import * as React from "react";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GeoCandidateView } from "@/server/geo/providers";
import type { ActionResult } from "@/server/actions/helpers";

/**
 * The "look up this address" control and its list of candidates.
 *
 * Shared by the place editor and a contact's addresses so the two cannot drift
 * into two different failure stories — and because the rules this encodes are
 * the interesting part: the button is pressed deliberately rather than firing
 * while you type (Nominatim's usage policy forbids search-as-you-type, and an
 * address should not leave the machine as a side effect of browsing), and
 * accepting a candidate writes nothing. It fills the form, visibly, so it can
 * be corrected before a single Save posts the lot.
 *
 * The caller owns the query and the fields: this component knows only how to
 * ask and how to hand back an answer.
 */
export function PlaceLookup({
  buildQuery,
  search,
  onAccept,
  idleLabel = "Look up this address",
}: {
  /** What to send. Return empty to refuse — nothing is sent. */
  buildQuery: () => string;
  search: (query: string) => Promise<ActionResult<{ candidates: GeoCandidateView[] }>>;
  onAccept: (candidate: GeoCandidateView) => void;
  idleLabel?: string;
}) {
  const [candidates, setCandidates] = React.useState<GeoCandidateView[] | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [error, setError] = React.useState<string>();

  async function lookUp() {
    const query = buildQuery();
    if (!query) {
      setError("Fill in the address first, then look it up.");
      return;
    }

    setLooking(true);
    const result = await search(query);
    setLooking(false);

    if (!result.ok) {
      setError(result.error ?? "That lookup didn't work.");
      setCandidates(null);
      return;
    }
    setError(undefined);
    setCandidates(result.data?.candidates ?? []);
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={looking}
        onClick={() => void lookUp()}
      >
        <Search className="size-3.5" />
        {looking ? "Looking…" : idleLabel}
      </Button>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {candidates?.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing matched. Fill it in by hand.
        </p>
      ) : null}

      {candidates?.length ? (
        <ul className="grid gap-1.5 rounded-lg border border-border p-1.5">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.osmType}-${candidate.osmId}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  onAccept(candidate);
                  setCandidates(null);
                }}
                // `min-w-0` on both the button and the label: without it the
                // flex child refuses to shrink below its content and a long
                // display name pushes the row off the side of a phone.
                className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent-11" />
                <span className="min-w-0 flex-1">{candidate.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The hidden inputs that carry an accepted candidate's identity to the action.
 *
 * Coordinates and the OSM reference travel together or not at all: an id
 * pointing at one venue beside coordinates from another is worse than neither,
 * and `mapLinkFor` prefers the id — so the map would open the wrong place.
 */
export function AppliedPlaceFields({ applied }: { applied: GeoCandidateView | null }) {
  if (!applied?.latitude || !applied.longitude) return null;
  return (
    <>
      <input type="hidden" name="latitude" value={applied.latitude} />
      <input type="hidden" name="longitude" value={applied.longitude} />
      {applied.osmType ? (
        <input type="hidden" name="osmType" value={applied.osmType} />
      ) : null}
      {applied.osmType && applied.osmId ? (
        <input type="hidden" name="osmId" value={applied.osmId} />
      ) : null}
    </>
  );
}
