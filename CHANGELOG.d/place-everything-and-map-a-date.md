### Dates on the map, and a way to place everything at once — 2026-09-05

*Schema: none*

#### Added
- **A logged date can now say where it was, and how far away.** Every other part
  of the app learned to measure distances; the dating module did not, which was
  backwards — it is the part the feature exists for. A date's venue was already
  resolved to a saved place, on the interaction it mirrors, but nothing ever read
  it back. Now a logged date carries a map link and, once the venue and your home
  base are both placed, how far away it was. Nothing appears until they are.
- **"Place everything at once", under Settings → Places.** Addresses and places
  you saved before coordinates existed had to be placed one form at a time, which
  for an account with two hundred contacts meant not at all. This walks them.
  Only an exact, single match is written: anything the lookup is unsure about is
  left for you, because a pin in the wrong city looks answered when it is not.
  It reports how many it placed and how many need a look, and you can stop it.

  Available only when address lookup points at Photon or your own instance.
  The public OpenStreetMap service runs on donated hardware and its usage policy
  asks applications not to geocode in bulk — so on that endpoint the panel says
  so instead, and the one-at-a-time button keeps working as before. A private
  contact's address is never included, whatever the toggle says.

#### Fixed
- **A place you first visited on a date was born without its city.** The venue
  reached the saved place but the city typed beside it did not, so a place
  created that way had a name and nothing else — and could never be measured or
  mapped, however much was filled in later. Logging or editing a date now gives
  the place its city too. Coordinates are still never overwritten: the venue's
  name says *which* place you mean, not where it is.
- **Distances on a dating profile ignored your unit setting.** The "Distance"
  figure — the one you type from what somebody told you — was always labelled
  "km", including on the compare table, so it contradicted the miles-or-
  kilometres choice added last release. It now reads in your unit. It is still
  yours to type: where their address is placed and you have a home base, the
  measured distance is shown beside it rather than replacing it, since one is
  arithmetic and the other is what somebody said.

#### Security
- **A place belonging to another account can no longer surface on a logged
  date.** `Interaction.place` is the one reference the database cannot make
  same-owner — a `SET NULL` key needs every column nullable, and `ownerId` is
  not — so a restore can leave one pointing across accounts. The timeline
  already dropped a mismatch; the new read of a date's venue now does too.
- **A place hidden by the privacy lock is no longer counted or sent.** The bulk
  pass selected places by owner alone, so one known only through a private
  interaction appeared in the count and had its name and address sent to the
  geocoder. It now uses the same visibility predicate as the places list.
- **A correction to a place could still be lost to a save happening at the same
  time.** The rule that a place's city and coordinates are filled in but never
  rewritten was decided from a snapshot read, so an edit committing in the
  meantime was overwritten rather than respected — including coordinates set
  deliberately on the place's own page. Each write now carries its own condition
  and the database checks it at the moment of writing, so the rule holds under a
  concurrent edit rather than only when nobody else is working — and holds the
  same way whichever MariaDB version an installation runs against.
