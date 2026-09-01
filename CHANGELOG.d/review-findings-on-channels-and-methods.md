### Review findings on the new write paths — 2026-09-01

*Schema: none*

#### Fixed
- **An email channel saved with only a username, or only a password, now says
  so.** Nodemailer is handed a credential only when both halves are present, so
  a channel with one of them looked configured and then sent unauthenticated —
  which most relays reject, on every reminder, with nothing on screen to
  explain it.
- **Contact methods and addresses are bounded to their column widths.** An
  over-long paste reached MariaDB and came back as an exception thrown out of
  the action rather than something the form could render. The forms mirror the
  limits with `maxLength`.
- **The test-notification rate limit is per account rather than per channel.**
  Keyed by channel, it was reset by creating another one, so nothing stopped a
  caller pointing several channels at the same host and testing each in turn.
- **Making a method primary moves it to the front of the list.** The list
  renders primary-first while the reorder arrows step through `sortOrder`, so a
  promoted last method appeared at the top with a down arrow that found no
  later row and did nothing.
- **A rejected form says which field is wrong.** Field-level errors were
  discarded in favour of the generic "Please check the highlighted fields",
  which highlighted nothing — so a port out of range or a bad URL gave no clue
  which of seven inputs to correct.
- **The test suite no longer depends on a local `.env` for `AUTH_SECRET`.**
  Everything that encrypts at rest derives its key from it and throws without
  one, so the encryption tests passed locally and failed in CI — the worst
  shape for it, since the machine that runs least often is the one that tells
  the truth.
