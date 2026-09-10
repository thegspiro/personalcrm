"use client";

import * as React from "react";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TYPEAHEAD_MIN_QUERY, type GeoCandidateView, type LookupUi } from "@/server/geo/providers";
import { shouldSuggest } from "@/lib/typeahead";
import type { ActionResult } from "@/server/actions/helpers";

/**
 * The address lookup, as a form field sees it.
 *
 * A hook rather than a component because the interesting attributes belong on
 * the caller's own text input: `role="combobox"`, `aria-expanded`,
 * `aria-activedescendant` and the arrow keys cannot be put on a wrapper without
 * lying to a screen reader, and the input lives in the form, beside its label.
 * So the caller keeps its field and spreads `inputProps` onto it.
 *
 * All three surfaces — a contact's address, the place editor and the home base
 * — use this one hook, so they cannot drift into three different failure
 * stories. The rules it encodes are the interesting part:
 *
 * - The button is pressed deliberately. Suggestions while typing are a separate
 *   opt-in, off unless an administrator has asked for it *and* the endpoint's
 *   operator permits it — the public OpenStreetMap service forbids it outright.
 * - Nothing is sent on a page load. An edit form opens with a query already
 *   assembled from the fields it is showing, so this is a real risk rather than
 *   a theoretical one; `shouldSuggest` is where it is refused.
 * - Accepting a candidate writes nothing. It fills the form, visibly, so it can
 *   be corrected before a single Save posts the lot.
 * - A failure while typing is silent and final. An unreachable endpoint would
 *   otherwise put an error under the field on every keystroke and cost a
 *   timeout per pause; one failure falls back to the button for good.
 */

/** Long enough that a pause means a pause, short enough not to feel stuck. */
const DEBOUNCE_MS = 350;

export interface PlaceLookupHandle {
  /** Spread onto the caller's own text input. Empty when nothing is offered. */
  inputProps: React.ComponentProps<"input">;
  /** The suggestion list and its hint. Render directly beneath the input. */
  suggestions: React.ReactNode;
  /** The button and its messages. Render where the lookup control belongs. */
  panel: React.ReactNode;
}

export interface PlaceLookupOptions {
  /**
   * Whether to offer anything at all.
   *
   * False for a private contact, whose address is never sent anywhere whatever
   * the settings say, and false when lookup is switched off.
   */
  enabled: boolean;
  lookup: LookupUi;
  /** Exactly what would be sent. One string, so the hint cannot misdescribe it. */
  query: string;
  /**
   * The string whose *change* starts a debounce, when that is not the whole
   * query. Defaults to `query`.
   *
   * The two differ where the query carries something that is not the address
   * being typed. The place editor sends "name, address" — the better query,
   * since a venue's name helps — but renaming a place is not typing an address,
   * and watching the join meant a rename quietly sent the new name and the old
   * address to a geocoder. The trigger there is the address field alone.
   */
  typeaheadTrigger?: string;
  search: (
    query: string,
    options?: { interactive?: boolean },
  ) => Promise<ActionResult<{ candidates: GeoCandidateView[] }>>;
  onAccept: (candidate: GeoCandidateView) => void;
  /** Unique within the document — two address forms can be open at once. */
  listId: string;
  idleLabel?: string;
}

export function usePlaceLookup({
  enabled,
  lookup,
  query,
  typeaheadTrigger,
  search,
  onAccept,
  listId,
  idleLabel = "Look up this address",
}: PlaceLookupOptions): PlaceLookupHandle {
  /**
   * The candidates, and which query they answer.
   *
   * One value rather than two, because they must change together. Keep typing
   * after results appear and the list from the previous query stayed open and
   * selectable right through the debounce and the next request, so Enter could
   * fill in a match for text the field no longer held. Holding the query
   * alongside its answer closes the list the moment it stops describing what is
   * in the box — whether the user typed more, deleted below the minimum, or
   * cleared the field. A ref would not do: it changes without a render, so the
   * list would go on being drawn from a stale comparison.
   */
  const [answer, setAnswer] = React.useState<{
    forQuery: string;
    candidates: GeoCandidateView[];
  } | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);

  const typing = enabled && lookup.typeahead;
  const trigger = typeaheadTrigger ?? query;

  // What the form opened with. The guard that keeps "never on a page load" true.
  const initialTrigger = React.useRef(trigger);
  const lastSent = React.useRef<string | null>(null);
  const suspended = React.useRef(false);
  const broken = React.useRef(false);
  const composing = React.useRef(false);
  const sequence = React.useRef(0);
  const listRef = React.useRef<HTMLUListElement>(null);
  /**
   * The field itself, so a button press can hand focus back to it.
   *
   * The arrow keys live on the input — that is where the combobox pattern puts
   * them, and an option in a listbox is deliberately not focusable. But the
   * button that opens the list is several fields further down the form, so
   * without this a keyboard user who presses "Look up" is left standing on the
   * button, with the results they asked for reachable only by shift-tabbing
   * back past every field in between.
   */
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Held in refs and left out of the effect's dependencies: both arrive as new
  // closures on every render of the form, and depending on them would restart
  // the debounce on renders that changed nothing.
  const searchRef = React.useRef(search);
  const acceptRef = React.useRef(onAccept);
  React.useEffect(() => {
    searchRef.current = search;
    acceptRef.current = onAccept;
  });

  const shown = answer?.candidates ?? [];
  const listOpen = open && shown.length > 0 && answer?.forQuery === query.trim();

  const accept = React.useCallback((candidate: GeoCandidateView) => {
    // Accepting writes the matched street back into the field, which changes
    // the query. Without this the list would reopen under the field the user
    // has just finished with.
    suspended.current = true;
    setAnswer(null);
    setOpen(false);
    setActive(-1);
    setError(undefined);
    acceptRef.current(candidate);
  }, []);

  const dismiss = React.useCallback(() => {
    // Recorded rather than flagged, so the very next keystroke searches again.
    lastSent.current = trigger.trim();
    setAnswer(null);
    setOpen(false);
    setActive(-1);
  }, [trigger]);

  React.useEffect(() => {
    if (!typing || composing.current) return;

    const permitted = shouldSuggest({
      query: trigger,
      initialQuery: initialTrigger.current,
      lastSent: lastSent.current,
      minLength: TYPEAHEAD_MIN_QUERY,
      suspended: suspended.current,
      broken: broken.current,
    });

    if (!permitted) {
      // One render absorbs the write-back an accepted candidate caused; the
      // keystroke after it searches normally.
      suspended.current = false;
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const text = query.trim();
        lastSent.current = trigger.trim();
        const mine = (sequence.current += 1);
        setLooking(true);

        const result = await searchRef.current(text, { interactive: true });

        // A superseded answer is discarded rather than shown: a server action
        // cannot be aborted, so a slow one can still arrive after a newer one.
        // The newer request owns the spinner in that case, so it is left alone.
        if (mine !== sequence.current) return;
        // Cleared before the cancellation check, never after. The effect being
        // torn down without a replacement request — deleting back below the
        // minimum, say — used to leave "Looking…" on screen for good, with the
        // button disabled beside it and no way back.
        setLooking(false);
        if (cancelled) return;

        if (!result.ok) {
          // One failure is enough. An endpoint that is not answering would
          // otherwise spend the whole timeout again on every pause.
          broken.current = true;
          setAnswer(null);
          setOpen(false);
          return;
        }
        const found = result.data?.candidates ?? [];
        setAnswer({ forQuery: text, candidates: found });
        setActive(-1);
        setOpen(found.length > 0);
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typing, query, trigger]);

  async function lookUp() {
    const text = query.trim();
    if (!text) {
      setError("Fill in the address first, then look it up.");
      return;
    }

    // Claims the sequence too, so a suggestion still in flight from a moment
    // ago cannot land on top of the answer the user actually asked for.
    const mine = (sequence.current += 1);
    setLooking(true);
    const result = await search(text);
    if (mine !== sequence.current) return;
    setLooking(false);

    if (!result.ok) {
      setError(result.error ?? "That lookup didn't work.");
      setAnswer(null);
      setOpen(false);
      return;
    }
    setError(undefined);
    // A press that worked clears an earlier failure, so suggestions resume
    // rather than staying switched off for the life of the form because the
    // endpoint was briefly unreachable.
    broken.current = false;
    lastSent.current = trigger.trim();
    const found = result.data?.candidates ?? [];
    setAnswer({ forQuery: text, candidates: found });
    setActive(-1);
    setOpen(found.length > 0);
    // Focus follows the answer, so the arrow keys reach it. Only when there is
    // something to move through: taking focus off the button to say "nothing
    // matched" would be a second surprise on top of the first.
    if (found.length > 0) inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % shown.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // This field sits inside a form; without this, Enter saves it.
      event.preventDefault();
      accept(shown[active]);
    } else if (event.key === "Escape") {
      // The place editor lives in a sheet, which would otherwise take an
      // Escape meant for the list as an instruction to close the whole editor.
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  }

  /**
   * Keyed on `enabled`, not on `typing`.
   *
   * The list is an autocomplete popup either way; the only difference between
   * the two modes is what opens it. Installing these only while typing left the
   * default configuration — lookup on, suggestions off — with a list of
   * non-focusable options and no key handling at all: you could press "Look up"
   * with a keyboard and then reach none of the results. The markup this
   * replaced used real buttons, so that was a regression rather than an
   * omission, and axe cannot catch it because the ARIA is well-formed either
   * way. One code path rather than two, which is the reason this is a shared
   * hook at all.
   */
  const inputProps: React.ComponentProps<"input"> = enabled
    ? {
        ref: inputRef,
        role: "combobox",
        "aria-expanded": listOpen,
        // Never a dangling id: an `aria-controls` pointing at an element that
        // is not in the document is a serious axe finding, and the end-to-end
        // suite fails on those.
        "aria-controls": listOpen ? listId : undefined,
        "aria-autocomplete": "list",
        "aria-activedescendant":
          listOpen && active >= 0 ? `${listId}-option-${active}` : undefined,
        autoComplete: "off",
        onKeyDown,
        onBlur: (event) => {
          const next = event.relatedTarget as Node | null;
          if (next && listRef.current?.contains(next)) return;
          setOpen(false);
        },
        onCompositionStart: () => {
          composing.current = true;
        },
        onCompositionEnd: () => {
          composing.current = false;
        },
      }
    : {};

  const list = listOpen ? (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      className="mt-1.5 grid gap-1.5 rounded-lg border border-border p-1.5"
    >
      {shown.map((candidate, index) => (
        <li
          key={`${candidate.osmType}-${candidate.osmId}-${index}`}
          id={`${listId}-option-${index}`}
          role="option"
          aria-selected={index === active}
          // `min-w-0` on the row and the label both: without it the flex child
          // refuses to shrink below its content and a long display name pushes
          // the row off the side of a phone.
          className={`flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
            index === active ? "bg-muted" : "hover:bg-muted"
          }`}
          // Mouse down rather than click, and prevented, so the field never
          // loses focus and the blur handler never closes the list first.
          onMouseDown={(event) => {
            event.preventDefault();
            accept(candidate);
          }}
        >
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent-11" />
          <span className="min-w-0 flex-1">{candidate.label}</span>
        </li>
      ))}
    </ul>
  ) : null;

  const suggestions = !enabled ? null : (
    <>
      {list}
      {typing ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Suggesting from {lookup.providerLabel} ({lookup.endpointHost}) as you type.
        </p>
      ) : null}
    </>
  );

  const panel = !enabled ? null : (
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

      {answer?.candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing matched. Fill it in by hand.</p>
      ) : null}
    </div>
  );

  return { inputProps, suggestions, panel };
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
      {applied.osmType ? <input type="hidden" name="osmType" value={applied.osmType} /> : null}
      {applied.osmType && applied.osmId ? (
        <input type="hidden" name="osmId" value={applied.osmId} />
      ) : null}
    </>
  );
}
