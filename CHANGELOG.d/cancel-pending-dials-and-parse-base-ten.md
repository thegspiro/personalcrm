### Delivery dials, tag merges and the free-space guard — 2026-09-03

*Schema: none*

#### Fixed
- **A delivery given up on no longer keeps dialling.** When a hostname
  resolved to several unreachable addresses, the attempt to connect worked on
  through the list after the send had been abandoned — so a later address could
  still connect and carry the message, arriving once the scheduler had recorded
  a failure and queued the retry. The delivery's budget now reaches the dial
  itself, and no attempt outlives it.
- **A tag merge no longer adopts another account's person.** The join and the
  contact are separate foreign keys, so an import or a restore can leave this
  account's tag on someone it does not own; that row was copied onto the
  destination tag rather than left where it was.
- **The free-space guard is no longer skipped by a leading zero.** A
  `BACKUP_MIN_FREE_MB` of `08` or `09` passed every validation and then was an
  invalid octal literal to the shell — and because the comparison sits in an
  `if`, the error read as false rather than stopping the run, so the dump went
  ahead with the disk nearly full. Both sides of the comparison are read as
  base ten.
