### Birthdays are reminded about again — 2026-09-05

*Schema: none*

#### Fixed
- **A birthday entered on the contact form now produces a reminder.** It was
  shown on the dashboard, the timeline and the contact page but never sent: the
  scheduler read only the important-dates table, and the birthday field does not
  write a row there. Both the individual reminder and the daily digest missed it.
- **One reminder per birthday, on the date you can see.** Where an older
  important-date birthday row exists alongside it, the row no longer sends a
  second reminder — nor an outdated one, if the birthday has since been edited.
  Upgrading does not re-send a birthday already sent this year.
- **A birthday with no known day stays quiet** rather than announcing itself on
  a day nobody supplied. One recorded as a month or a year only is skipped;
  a birthday whose year is unknown still reminds every year, as before.
