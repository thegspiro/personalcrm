### Reminders say how overdue, and what is coming up — 2026-10-05

*Schema: none*

#### Changed
- **Every reminder says how late it is, in days.** Keep-in-touch and task
  messages read "Reaching out to Dana is 12 days overdue (due 2026-09-23)"
  rather than "has been due since 2026-09-23", and digest lines read
  "(12 days overdue)", "(due today)" or "(in 3 days, 2026-10-08)".
- **The daily digest ends with a "Coming up" section**: every important date in
  the next 14 days that the digest had not already listed, birthdays included.
  Dates whose reminders are switched off are left out. Nothing in it is sent
  as a reminder early; each still arrives on its own day.
- **Birthdays state the age reached** ("turning 40") when the year was
  recorded, in the birthday reminder and in the digest. A birthday saved
  without a year shows no age.
- Gotify's `extras` gain `age` on birthdays and a `daysAway` on each digest
  entry. Existing fields keep their values, so anything already reading them is
  unaffected; digest entries can now have the kind `UPCOMING_DATE`.

#### Fixed
- **A date recorded only to the month or the year no longer sends reminders.**
  An important date saved as "June 2019" is stored as 1 June, and the
  scheduler announced "is today" on that stand-in day every year, a date
  nobody gave. Birthdays already skipped such dates; every other important
  date now does too.
