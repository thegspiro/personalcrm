### A time of day on the things you mean to do — 2026-09-04

*Schema: `20260904150000_add_plan_times`*

#### Added
- **Something on your "Things to do" list can now say what time, and how long.**
  A plan could be pencilled in for a day but never for an evening, so "dinner
  Friday" and "dinner Friday at 7" were the same record. Both are optional, both
  are blank on every plan you already have, and a plan with a day and no time
  reads exactly as it did before. The time is stored as a local wall-clock
  reading against the day rather than as a moment, so it does not drift when the
  clocks change or when you travel: 7pm stays 7pm.

#### Changed
- **A plan that could not be saved now says the time might be why.** The message
  named only the category and the checklist, which were the only two things that
  could fail it.
