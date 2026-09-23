### Three claims the code did not back — 2026-09-01

*Schema: none*

#### Fixed
- **A reminder is no longer delivered twice when its channel is deleted and
  recreated in the same due window.** The ledger's uniqueness key includes the
  channel id, and deleting a channel nulls that id rather than the row, so a
  replacement got a fresh key and the occurrence went out again — despite a
  comment stating that deletion could not restart delivery. The scheduler now
  checks for the orphaned, already-delivered row before sending, and the
  comment says what the `SET NULL` does and does not guarantee.
- **Choosing a different channel kind now clears the form.** The add form is
  uncontrolled and was not remounted, so the fields shared between kinds kept
  what had been typed and the name's default was never reapplied: picking ntfy,
  typing its token, then picking Gotify saved a channel named "ntfy" with the
  ntfy token encrypted as its Gotify application token.
- **The container's boot checks no longer describe links that reminders do not
  contain.** Preflight warned that omitting `APP_URL` left notification links
  with no address, and that a trailing slash produced double slashes in them.
  Reminder bodies carry no links, and `APP_URL` is read in exactly one place —
  whether session cookies are marked secure. The trailing-slash check is gone
  because nothing concatenates onto the value, and the remaining warning says
  only what is true.
