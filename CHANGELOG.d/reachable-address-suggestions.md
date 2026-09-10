### Address lookup results are reachable from the keyboard again — 2026-09-10

*Schema: none*

#### Fixed
- **A looked-up address can be chosen without a mouse.** The results of pressing
  "Look up" were rendered as rows that could not be focused or activated by
  keyboard, so a keyboard-only user could ask the question and never reach the
  answer. Arrow keys move through the results, Enter accepts one and Escape
  dismisses the list — in every configuration, whether the results came from the
  button or from typing. This affected any account with address lookup switched
  on, including with suggestions-while-typing off.
- **An unreachable endpoint now says so.** It used to report "Nothing matched",
  which reads as *your address is wrong* when in fact nothing was ever asked.
  It also means a field that suggests as you type stops after one failure and
  falls back to the button, rather than waiting out the timeout again at every
  pause.
- **The lookup control cannot be left stuck on "Looking…".** Clearing the box
  while a suggestion was in flight disabled the button with no way back.
- **A suggestion list is no longer accepted for an address you have moved on
  from.** Keep typing after results appear and the old list stayed selectable
  for as long as the next request took, so Enter could fill in a match for text
  the field no longer held.
- **Renaming a place no longer sends anything.** With suggestions-while-typing
  on, editing a place's *name* sent the new name and the existing address to the
  geocoder, even though the setting offers to suggest while an *address* is
  typed. Only the address field starts a suggestion now; pressing the button
  still searches the name and address together, which is the better question.
- **The protected OpenStreetMap endpoint is recognised however it is spelled.**
  A hostname written with a trailing dot — a valid way to write the same
  name — slipped past the check that keeps the OpenStreetMap Foundation's own
  service from being typed at, bulk-geocoded against, or queried faster than its
  policy allows. A port written out did the same. Both are now read as the host
  they are.
- **A lookup reads the settings once.** Whether it is switched on, which
  endpoint answers, and whether it may be typed at were three separate reads, so
  a change made between them could send a request to one endpoint under
  permission granted for another. It is also a third of the database queries it
  was.
