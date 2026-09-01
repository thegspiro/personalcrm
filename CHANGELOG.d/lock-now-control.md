### Close the privacy lock without waiting for the timeout — 2026-08-31

*Schema: none*

#### Added
- **A lock button in the header while private content is open.** The fifteen
  minute idle timeout covers walking away; this covers handing someone your
  phone. It clears the offline cache before locking, so pages already written
  to disk do not outlive the lock, and it doubles as the only visible sign
  that private content is open at all.
