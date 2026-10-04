### Their people, shared and remembered — 2026-10-04

*Schema: `20261004120000_share_associates_and_add_notes` (hand-edited, ships a
`down.sql`)*

#### Added

- **Someone can be in more than one person's life.** When a friend's colleague
  turns out to be another friend's climbing partner, "Already noted through
  someone else?" links the existing entry instead of writing them down twice,
  and each friend keeps their own "how they know them".
- **Notes that remember who told you.** Each person in their life now holds as
  many notes as you like — recent news with an "as of" date (partial dates
  allowed), or lasting details — and each records which friend you heard it
  from, or that you heard it from them directly.
- **What a friend may not know is kept apart.** On a friend's page, what *they*
  told you is shown plainly; everything you heard elsewhere is shown muted under
  "Heard elsewhere — they may not know", so you can avoid raising it with
  someone who never heard it.
- **A page for each of them**, under People → Their people, with every note and
  every friend who knows them in one place. Notes are corrected there, more
  friends can be linked, and two entries that turn out to be the same person
  can be merged — links and notes move across, still saying who told you.

#### Changed

- **Tracking one as a person now carries every note across** as a fact on their
  new profile, each still saying who it came from, rather than copying a single
  note into the profile summary. A note heard from a private friend becomes a
  private fact.
- **Removing someone from a friend's life** keeps them while another friend
  still knows them; with the last one, the entry and its notes go too. Deleting
  a friend likewise removes everything you heard from them, and anyone known
  only through them.
- **The JSON export's `schemaVersion` is now 2.** Associates moved from
  `contacts[].associates` to a top-level `associates`, each with its `links` and
  `notes`. Anything that reads the old field needs updating.

#### Upgrading

Existing entries keep their friend, their wording and their note: the note
becomes a detail heard from that friend. Two entries for what is plainly the
same person stay two entries until you merge them — the upgrade does not guess
from names. With the privacy lock closed, a note heard from a private contact
is hidden, and so is anyone known only through private contacts.
