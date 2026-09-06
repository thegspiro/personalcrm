### Settle what a second tab can do mid-write — 2026-09-03

*Schema: none*

#### Fixed
- **Merging or deleting a tag from a locked session no longer touches a private
  assignment made a moment earlier.** The question "is this tag on anyone
  private?" was asked before the write began, so an unlocked tab could put the
  tag on a private person in the gap; the merge then carried that association
  to the other tag, and the delete took it away with the cascade — a locked
  session changing a record it cannot see. The question is now asked with both
  tags held, so the answer cannot go stale between asking and acting.
- **Saving a contact no longer fails outright when one of its tags is deleted
  mid-save.** The tag was checked and then inserted, and a deletion in between
  turned the whole save into a server error and rolled it back. The submitted
  tags are held for the write, so the save either keeps the tag or reports that
  one is unavailable, which is what the form is built to show.
- **Two password changes at once no longer sign you out.** Both confirmed the
  old password before either wrote, and the second then treated the first's
  freshly issued session as somebody else's and ended it — leaving the account
  with no session at all while both changes reported success. A change now
  applies only if the password is still the one that was confirmed; the other
  is told the current password is wrong, which by then it is.
- **`TZ` set with a stray space is now called out at startup.** The check
  trimmed before looking, so the zone was reported as valid while the system
  matched nothing and fell back to UTC — putting the daily backup hours away
  from the hour that was configured, with nothing said about it.
