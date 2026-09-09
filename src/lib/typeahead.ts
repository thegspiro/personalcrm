/**
 * When a field that suggests addresses may actually send one.
 *
 * Pure and free of React so the rules can be unit-tested directly. That matters
 * more here than it usually does: two of them are privacy rules rather than
 * niceties, and the repository has no jsdom, no React Testing Library and no
 * way to assert them through a rendered component. `docs/privacy.md` states
 * them as promises; this is where they are enforced.
 */

export interface SuggestState {
  /** What the field holds now. */
  query: string;
  /**
   * What the field held when the form was opened.
   *
   * The one that stops a page load from being a request. The query a form
   * sends is a join of the address lines, city, region and country — so
   * opening an address that is already filled in produces a long, plausible
   * query before a single key has been pressed. Without this, editing an
   * existing address would put it on the wire just by looking at it.
   */
  initialQuery: string;
  /** The last query actually sent, so the same string is never sent twice. */
  lastSent: string | null;
  minLength: number;
  /**
   * Set when a suggestion is accepted or the list is dismissed.
   *
   * Accepting writes the matched street back into the field, which changes the
   * query, which would otherwise reopen the list under the field the user has
   * just finished with.
   */
  suspended: boolean;
  /**
   * A previous attempt failed.
   *
   * An unreachable endpoint would otherwise cost a full timeout on every pause
   * and put an error under the field on every keystroke. One failure is enough:
   * the button is still there.
   */
  broken: boolean;
}

export function shouldSuggest(state: SuggestState): boolean {
  if (state.broken || state.suspended) return false;

  const query = state.query.trim();
  if (query.length < state.minLength) return false;

  // Never on a page load. Typing something and deleting back to exactly what
  // was there counts as not having typed.
  if (state.query === state.initialQuery) return false;

  return query !== state.lastSent;
}
