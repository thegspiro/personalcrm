### Corrections to the new plan times — 2026-09-05

*Schema: none*

#### Fixed
- **A time on the day the clocks go back was an hour early.** Resolving a plan's
  time counted minutes forward from midnight, which is only right on a 24-hour
  day. On the one day a year that runs to 25, every time after the change read
  an hour early — a 7:30pm plan resolved to 6:30pm. The wall clock is now
  searched for rather than counted to, so it means what it says on both
  transition days.
- **A length that was not one of the offered choices could vanish.** The picker
  offers seven, but any whole number of minutes can be stored. A plan holding
  anything else showed a blank box, and saving an unrelated change to that plan
  cleared the length. Whatever is stored is now offered alongside the presets.
- **A day that could not be read is no longer treated as no day at all.** A
  malformed date submitted directly to the server saved as a plan with no date,
  reported success, and quietly dropped the time with it. It is now refused.
- **Someone archived can no longer be added to the dating pipeline.** The
  pipeline leaves archived people out, so the action said it had added them and
  they never appeared. The menu no longer offers it, and the action itself
  refuses and says to restore them first — so a second tab or a page left open
  cannot slip past the menu.

#### Changed
- **How long something takes no longer needs a date.** It is a property of the
  outing, not of the day you picked for it, so "the observatory takes most of an
  evening" is worth keeping on a plan nobody has scheduled yet. Only the start
  time still needs a day to hang on, and the length now shows on the row whether
  or not a day is set.
