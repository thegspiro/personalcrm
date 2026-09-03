### Re-key the surviving session on a password change — 2026-09-03

*Schema: none*

#### Fixed
- **Changing your password now issues this device a new session token.** Ending
  every *other* session, as the previous release did, never touched a stolen
  copy of your own cookie: a copy holds the same token, so it resolved to the
  same session — the one the change was careful to keep. Anyone holding one
  stayed signed in. The session that survives is re-keyed and its cookie
  rewritten, which retires every outstanding copy, and its expiry is reset
  along with it.
- **Merging a tag no longer loses assignments if the other tag disappears
  first.** Deleting one of the two tags in another tab while a merge was in
  flight had the assignments silently discarded and the source tag deleted on
  top of them, so the tag came off those people entirely and the merge reported
  success. Both tags are now held for the duration of the merge. Renaming a tag
  or putting one on someone in that same window said "Tag not found" as well,
  instead of failing as a server error.
- **A backup setting made of spaces is now rejected at startup rather than
  after it.** `BACKUP_TIME`, `BACKUP_RETENTION_DAYS` and `BACKUP_MIN_FREE_MB`
  set to whitespace passed the boot-time check, then stopped the backup service
  on every restart for as long as the container ran. `DATABASE_URL` is checked
  the same way, and padding around it is now named rather than trimmed away —
  the value reaches the database driver exactly as you set it.
