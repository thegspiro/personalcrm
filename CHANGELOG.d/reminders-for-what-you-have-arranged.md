### Reminders for what you have arranged — 2026-09-06

*Schema: `20260906010000_add_plan_reminders` — nullable `Plan.reminderDaysBefore`, and `PLAN` appended to the reminder ledger's entity list*

#### Added
- **A plan can remind you.** Anything in Things to do with a day on it can now
  send a reminder through the channels you already have set up under Settings →
  Reminders: on the day, the day before, a week before, or any set of days you
  type in. It names the evening, who it is with and the time you set, and it is
  worded from the day it actually goes out, so a message delayed overnight says
  "was yesterday" rather than still promising tonight.

  **This does nothing until you switch it on.** Every plan starts at *No
  reminders* — including every plan you have already scheduled — and stays there
  until you choose otherwise. That is deliberate, and different from an
  important date, where leaving the setting alone means "use my account
  default": a birthday is a fact worth volunteering, and an evening you arranged
  yourself is not something the app should start announcing unasked. Nothing
  will arrive after upgrading that you did not ask for.

  The setting is on the plan form and on the *Schedule it* sheet, and once a
  plan is arranged the row says what it will send. Moving the evening moves the
  reminder with it; taking it off the books with "Not planned after all" stops
  it, as does ticking it done.
- **Arranged evenings appear in the daily digest.** Anything planned for the
  next three days is listed under *Arranged*, at the top, whether or not it
  sends a reminder of its own — the digest is a summary of what is coming, not a
  second copy of what has already been sent.

An evening with someone marked private is withheld from both while the privacy
lock is closed, and an evening saved against "Nobody yet" still reminds.
