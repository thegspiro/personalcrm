### Records from two accounts can no longer be joined — 2026-09-03

*Schema: `20260903140000_same_owner_join_keys`*

#### Changed
- **A tag assignment and a place alias now carry their owner, and their keys
  include it.** Each previously held two references that said nothing about one
  another, so a row could pair one account's person with another account's tag,
  or an alias with another account's place. Nothing the app does creates one —
  only an import or a restore — but every screen had to remember to exclude
  them. The database refuses them now.
- **The upgrade removes any such rows it finds, and says so at the next start.**
  They are associations nobody could see. The count appears once in the
  container log; on an installation that never had one, nothing is printed. A
  hand-run rollback is included beside the migration.
- Restoring a backup still bypasses the constraint, because a dump turns
  foreign-key checks off. The screens keep their own checks for that, and a
  place alias pointing somewhere unexpected is repaired on the next mention
  rather than followed.

#### Fixed
- **Assigning a tag, or saving a contact with one, could still publish a tag
  that had just become private-only.** Whether the lock was showing a tag was
  decided from a snapshot taken when the write began, so an unlocked tab could
  put it on someone private a moment later and the write would go ahead
  regardless. That question now holds the assignments it reads.
