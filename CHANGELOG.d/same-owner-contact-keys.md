### Same-owner keys on every relation to a person — 2026-09-04

*Schema: `20260904120000_same_owner_contact_keys`*

#### Changed
- **A record can no longer point at a person belonging to another account.**
  Facts, important dates, life events, relationships, family suggestion
  dismissals, ideas, tasks, happenings, gifts, debts, dietary needs, dating
  profiles, dates, plans and flags now reference the person by owner and id
  together, so the database refuses a row that spans two accounts instead of
  relying on every page to remember to filter one out.
- **The same for who was there.** Interaction participants and mentions, life
  event participants and household members each gain an owner of their own,
  taken from the interaction, event or household they belong to, and key on it
  from both sides. Before this, two independent keys meant an import could file
  your interaction against a stranger's contact, and the dashboard would show
  their name.

#### Fixed
- **A place belonging to another account no longer appears in your timeline.**
  Somewhere a visit was linked to could be rendered and searched without
  checking who owned it. The two place links are the only references that keep
  a single-column key — they clear rather than cascade on delete, and MariaDB
  will not accept that shape of key otherwise — so the timeline now checks the
  owner itself, and the upgrade detaches anything already mismatched.
- **The upgrade repairs an installation that already holds such a row.** Where
  the link is required the record is removed, along with any custom field
  values it had; where it is optional — an idea, a task, a plan, a place — the
  record is kept and only the link cleared, because it is your writing and the
  wrong person is the only thing wrong with it. A record pointing at a person
  who is not there at all, which a restore can equally leave behind, is
  repaired the same way rather than stopping the upgrade. The counts appear once in the
  container log on the next start, so nothing is removed silently. A restore of
  a dump taken before this upgrade re-runs the same repair.
