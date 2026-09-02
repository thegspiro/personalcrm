### Days that start at one o'clock — 2026-09-02

*Schema: none*

#### Fixed
- **Contacts due in the last hour of the day no longer disappear in zones whose
  clocks skip midnight.** Where a daylight-saving change moves the clock
  straight from 23:59 to 01:00 — Chile, Lebanon and others — the app took the
  day to have started an hour early, and dropped anyone due in that hour from
  the overdue count, the People due filter and the dashboard.
