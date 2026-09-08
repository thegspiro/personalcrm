import { describe, expect, it } from "vitest";
import { shouldSuggest, type SuggestState } from "@/lib/typeahead";

/**
 * When a field may send an address on its own.
 *
 * Two of these are privacy promises rather than niceties — `docs/privacy.md`
 * says nothing is sent on a page load, and that a suggestion never fires twice
 * for the same string — and there is no rendered-component test in this
 * repository that could assert them. This is where they hold.
 */

function state(overrides: Partial<SuggestState> = {}): SuggestState {
  return {
    query: "120 Maple Street",
    initialQuery: "",
    lastSent: null,
    minLength: 4,
    suspended: false,
    broken: false,
    ...overrides,
  };
}

describe("deciding whether to suggest", () => {
  it("suggests once enough has been typed", () => {
    expect(shouldSuggest(state())).toBe(true);
  });

  it("does not fire on the query a form opened with", () => {
    // The rule this exists for. A form's query is a join of the address lines,
    // the city, the region and the country — so opening an address that is
    // already filled in produces a long, plausible query before a key is
    // pressed. Without this, editing an address would put it on the wire just
    // by looking at it.
    const opened = "120 Maple Street, Arlington, Virginia, United States";
    expect(shouldSuggest(state({ query: opened, initialQuery: opened }))).toBe(false);
  });

  it("suggests again once the opened query is actually edited", () => {
    expect(
      shouldSuggest(state({ query: "120 Maple Str", initialQuery: "120 Maple Street" })),
    ).toBe(true);
  });

  it("stays quiet until there is enough to be worth a request", () => {
    expect(shouldSuggest(state({ query: "12" }))).toBe(false);
    expect(shouldSuggest(state({ query: "   12   " }))).toBe(false);
    expect(shouldSuggest(state({ query: "1200" }))).toBe(true);
  });

  it("never sends the same string twice", () => {
    expect(shouldSuggest(state({ lastSent: "120 Maple Street" }))).toBe(false);
    // Surrounding whitespace is not a new query either.
    expect(shouldSuggest(state({ query: " 120 Maple Street ", lastSent: "120 Maple Street" })))
      .toBe(false);
  });

  it("absorbs the write-back an accepted suggestion causes", () => {
    // Accepting fills the street in, which changes the query, which would
    // otherwise reopen the list under the field just resolved.
    expect(shouldSuggest(state({ suspended: true }))).toBe(false);
  });

  it("stops asking after a failure", () => {
    // An unreachable endpoint would otherwise cost a timeout on every pause and
    // put an error under the field on every keystroke. The button is still there.
    expect(shouldSuggest(state({ broken: true }))).toBe(false);
  });

  it("refuses on a failure even when everything else says yes", () => {
    expect(shouldSuggest(state({ broken: true, suspended: false, lastSent: null }))).toBe(false);
  });
});
