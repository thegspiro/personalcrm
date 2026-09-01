### Settings totals stop counting life events the lock is hiding — 2026-09-01

*Schema: none*

#### Fixed
- **A life event that names a private participant no longer counts towards its
  type's usage total on Settings.** The tally filtered on the event's anchor
  contact only, so an event filed against a public person but naming a private
  one was hidden from the timeline and counted on a page the lock does not
  gate — disclosing both the hidden event's type and how many exist. The rule
  is now the fragment `lifeEventPrivacyWhere`, applied by the timeline, the
  edit and delete guards and the tally alike, rather than hand-copied at four
  call sites and forgotten at the fifth.
- **Refusing to delete a taxonomy term no longer quotes a count the lock is
  holding back.** The guard behind that refusal stays unfiltered on purpose —
  filtering it would let a locked session delete a term that private rows point
  at, cascading them away — so only the figure is withheld: a locked session is
  told something still uses the term, without the number.
