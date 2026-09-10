### Readable names on the calendar — 2026-09-10

*Schema: none*

#### Fixed
- **The name and status inside a calendar entry are now readable.** A chip on
  the calendar puts the person's name after the title, and "ongoing" after that
  for something spanning several days. Both were drawn at 70% strength, which
  left green text on a green tint at 2.93 against the 4.5 the rest of the app is
  held to — worst on exactly the small text that most needs the contrast. They
  are now drawn at full strength; the separating dot is what sets them apart.
  The colours themselves were already chosen to clear the threshold, so nothing
  else about the chip changes.
- **The accessibility sweep now checks a calendar with something on it.** The
  check looked at whatever the account happened to hold on the day it ran, so a
  chip was only ever examined when other data landed in the month on show. That
  is how the faint text above survived: the run went green on the days no chip
  was there to measure. A calendar entry is now put on today deliberately before
  the page is checked.
