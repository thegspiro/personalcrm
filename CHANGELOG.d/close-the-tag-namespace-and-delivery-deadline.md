### Tag names, delivery limits and backup credentials — 2026-09-03

*Schema: none*

#### Fixed
- **A tag name can no longer be guessed at while the privacy lock is closed.**
  Creating or renaming necessarily answers "is this name already taken", and a
  taken name matching no tag you can see is one used only by private people —
  so a guess was confirmed while a free name saved. Both are held back until an
  unlock, as renaming a place already was. Assigning an existing tag, which
  changes no name, stays available.
- **Another account's tag now answers the same way whatever is on it.** The
  hidden-assignment check ran before ownership was established and was not
  scoped by owner, so deleting a stranger's tag returned the unlock message
  when it happened to be on one of *their* private contacts and "Tag not found"
  otherwise — a difference that is itself a fact about an account you cannot
  see.
- **A tag the lock is hiding can no longer be renamed** through an id kept by a
  Settings page that was rendered before the lock closed.
- **Notification deliveries open their own connection.** The default HTTP
  agents pool sockets by host and port rather than by the addresses a delivery
  validated, so a later request to the same origin could reuse an earlier
  socket and never run the pinned lookup at all.
- **A delivery now has a deadline on the clock, not just on silence.** Every
  transport timeout fires on inactivity, so an endpoint that trickles a byte
  every few seconds kept a send pending past the scheduler's five-minute lease
  — long enough for another pass to reclaim the row and send it twice.
- **A household is no longer saved with members missing.** A form filled in
  while unlocked and submitted after the lock closed silently dropped the
  private people from it and reported success.
- **Two alternate names that differ only by an accent no longer break a place
  edit.** The stored form keeps accents and the unique index does not, so both
  spellings reached the insert as one key and the constraint error rolled the
  whole edit back with nothing shown.
- **The backup's database password is written to volatile storage.** Under
  `/config` it survived a killed process or a power cut and sat beside the
  dumps, where a host-level sync would copy it. It now lives under `/run`
  (`BACKUP_RUNTIME_DIR`), and each run sweeps anything an earlier one left.
