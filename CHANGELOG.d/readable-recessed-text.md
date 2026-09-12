### Text you can read, even when it is set back — 2026-09-12

*Schema: none*

#### Fixed
- **Things drawn as "already dealt with" are now readable.** A settled debt, a
  trip that has been and gone, a type you switched off, a person in a stage you
  have stopped pursuing, the tally inside a pipeline badge, the "12d" beside a
  quiet contact, and the gap marker in a long list were all drawn by fading the
  text itself. That put small text between 1.9 and 2.9 against the 4.5 the rest
  of the app is held to — hardest on the 11px amounts and dates that need the
  contrast most. Each one now recedes by its background, or loses its colour,
  instead of losing contrast: a settled debt and a finished trip sit on a
  slightly recessed row, a type that is off is drawn in neutral grey rather than
  a faded version of its colour, and the counts and dates are simply drawn at
  full strength. Nothing changed about which of them is set back, only how.
- **Fading text was never a usable way to de-emphasise it here.** The palette
  leaves about half a step of headroom above the contrast threshold by design —
  the muted grey clears it at 5.3, and an amber type badge at 4.6 — so any
  amount of fading spends more than there is. The smallest fade that still
  reads is 93%, which is indistinguishable from none.

#### Added
- **The accessibility check now covers things drawn as set back.** These states
  had never been measured: the check looks at whatever the account holds, and
  these rows only exist once something has been settled, has finished, or has
  been switched off, so a green run said nothing about them. A settled debt, a
  finished trip and a switched-off type are now created deliberately and then
  checked. The switched-off type is created and removed within the check, so it
  cannot change what any other check sees.
