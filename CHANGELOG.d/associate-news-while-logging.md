### What they talked about, noted as you log — 2026-10-05

*Schema: `20261005120000_add_associate_note_source_interaction` (additive,
ships a `down.sql`)*

#### Added

- **Note news about the people in a friend's life while logging the
  conversation.** "Add someone they talked about" on the log and edit sheets:
  pick who told you (asked only when more than one person was there), who it
  is about — someone already in that friend's life, or someone new — and
  what's new. It is saved as an update dated to the conversation, heard from
  that friend, so it appears on their "Ask … about" card and on the person's
  own page with "at Coffee" beside it.
- **Editing a conversation shows what was already noted from it**, and can add
  more. Notes themselves are still corrected on the person's page.

#### Changed

- **A note heard in a private conversation is hidden with the lock closed**,
  as is one from a conversation a private contact was at — wherever the
  conversation itself is hidden. Deleting such a conversation deletes those
  notes too; deleting an ordinary one keeps them.
- **Tracking someone as a person** now links each copied fact to the
  conversation it came from, and keeps one from a private conversation private.
