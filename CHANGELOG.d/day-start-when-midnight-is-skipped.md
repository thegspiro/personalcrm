### Days that start at one o'clock, and twice — 2026-09-02

*Schema: none*

#### Fixed
- **Contacts due near midnight no longer land on the wrong day where the clocks
  move across it.** Where a daylight-saving change skips midnight — Chile,
  Lebanon — the app took the day to have started an hour early and dropped
  anyone due in that last hour from the overdue count, the People due filter
  and the dashboard. Where it repeats midnight instead, the day was taken to
  start at the second one, and a contact due in the repeated hour read as due a
  day early.
