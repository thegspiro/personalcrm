### Milestones in the right order, and less unreached code — 2026-09-10

*Schema: none*

#### Fixed
- **The Milestones summary on a profile now really shows the three most recent.**
  A profile merges the events someone recorded against a person with the ones
  that person only takes part in — a shared wedding, move, or bereavement. Each
  list arrived newest-first, but joining two ordered lists does not make one, so
  every shared event sorted behind every private one whatever its date. A
  milestone from a shared event could be left out of the summary while three
  older ones were shown, and the full "Significant moments" section listed the
  same events out of order. Both now read in date order.

#### Changed
- **Twelve unused packages are no longer installed.** A drag-and-drop library, a
  command palette, a date library the app never called, and nine unreferenced
  interface primitives were still being downloaded and audited on every install
  and shipped in the image. Nothing imported them.
- **Code nothing reached has been removed.** A gift-status endpoint superseded by
  the ordinary gift edit — which had been carrying the status itself precisely so
  that saving an edit could not un-give something already handed over — was still
  reachable as a server action, and server actions are public endpoints whether or
  not the interface calls them. Alongside it went an unused contact-interaction
  query, four unreached date and text helpers, and four interface components with
  no callers. No behaviour depended on any of them.
