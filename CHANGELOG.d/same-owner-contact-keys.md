### Same-owner keys on every relation to a person — 2026-09-04

*Schema: `20260904120000_same_owner_contact_keys`*

#### Changed
- **A record can no longer point at a person belonging to another account.**
  Facts, important dates, life events, relationships, family suggestion
  dismissals, ideas, tasks, happenings, gifts, debts, dietary needs, dating
  profiles, dates, plans and flags now reference the person by owner and id
  together, so the database refuses a row that spans two accounts instead of
  relying on every page to remember to filter one out. The two place links on
  interactions and plans keep their filter in code: they clear on delete rather
  than cascade, and MariaDB will not accept that shape of key.

#### Fixed
- **The upgrade repairs an installation that already holds such a row.** Where
  the link is required the record is removed; where it is optional — an idea, a
  task or a plan — the text is kept and only the link cleared, because it is
  your writing and the wrong person is the only thing wrong with it. The counts
  appear once in the container log on the next start, so nothing is removed
  silently. A restore of a dump taken before this upgrade re-runs the same
  repair.
