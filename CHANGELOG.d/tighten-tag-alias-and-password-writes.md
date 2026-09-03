### Tag, alias and password writes — 2026-09-03

*Schema: none*

#### Fixed
- **A tag the privacy lock is hiding can no longer be assigned.** A contact
  form loaded while unlocked keeps the ids of every tag it listed, and closing
  the lock in another tab does not empty that form. Saving it attached a tag
  that exists only on private people to a visible contact — writing a
  private-derived association from a locked session and publishing the hidden
  tag's name, since one visible use is what puts it back in the list. Adding,
  editing and the per-contact toggle all check the same scope the list does.
- **A place's alternate names can no longer be used to probe for a hidden
  one.** Renaming was already refused while locked, because uniqueness answers
  "is this name taken" and a taken name matching nothing you can see is a place
  the lock is hiding. Leaving the name alone and guessing an alias asked
  exactly the same question. Alias *changes* are now refused while locked;
  every other field still saves, including a save that resubmits the aliases
  unchanged.
- **A tag named in a script with no ASCII spelling can be created.** 朋友,
  Друзья and أصدقاء all folded to an empty key, and the tag was refused with
  "Use at least one letter or number." Latin accents still fold, so "Café" and
  "Cafe" remain one tag.
- **An alias is no longer followed to a place in another account.** The alias
  row's owner and its location's owner are separate columns, so an import or a
  restore can leave them disagreeing; the lookup accepted the alias on its own
  owner alone and returned the foreign place, where interactions would then
  have been logged and an address written. Such a claim is now re-pointed at
  the right place rather than followed.
- **A quick-add line resolves an alternate name that contains a comma.** The
  first comma marks where the note begins, so "Washington, D.C." could never
  match and a second place called "Washington" was proposed instead.
- **A failed password change no longer leaves the new password in place.** The
  hash and the session revocation were two commits: a failure in the second
  one kept the new password with every other session still signed in, while the
  action reported failure and the old password no longer worked to retry. Both
  now commit together.
