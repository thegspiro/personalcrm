### Honest list caps, a throttled front door, and a summary read in your own timezone — 2026-09-01

*Schema: `20260901120000_add_login_attempt_throttle`, then `20260901191500_drop_login_attempt_table` — the second undoes the first, so the net effect on an existing database is none*

#### Added
- **Repeated wrong sign-in attempts now back off.** Five at full speed, then a
  wait doubling from five seconds to a ceiling of fifteen minutes. The privacy
  PIN has had this since it shipped; the front door did not, which left the
  secondary lock better defended than the primary one. Counting is per
  address-and-client pair rather than per account, so nobody can lock you out
  of your own email address by guessing wrongly at it, and an address with no
  account is counted too — a throttle that fired only for real accounts would
  answer the question the login error refuses to. A successful sign-in clears
  the record, and a run of failures is forgotten after a day, so five typos
  last week do not throttle the first attempt today.

  The counters live in the process serving the request, in a structure of fixed
  size, rather than in a table. Nothing survives a restart and each replica
  keeps its own — the intended shape is one container — but in exchange the
  limiter cannot be grown by whoever is knocking, and there is no window
  between deciding and recording for a burst to slip through. A counter that
  has earned a penalty is never dropped to make room for a new one, so filling
  the limiter cannot be used to reset a throttle that is already holding. What
  the forwarded client address is worth, and what it is not, is written out in
  `docs/privacy.md`.

#### Fixed
- **Lists say when they have been cut short.** Every list here draws a bounded
  window rather than paging — 200 people, 100 timeline entries, 200 tasks,
  gifts, ideas and plans. Nothing said so, and a window that is full looks
  exactly like one that is complete: with 250 people the page counted all 250
  in the heading and drew 200 of them, and the fifty missing were
  indistinguishable from people who had never been added. Each list now says
  how many it is showing and what to do to reach the rest. The caps themselves
  are unchanged.
- **The reciprocity summary dates its span in your timezone.** "You got in
  touch 8 of the last 10 times — since March 2026" was formatted against the
  server's clock rather than the one in your preferences, so an evening
  interaction near a month boundary could be filed under the wrong month. It is
  the only date in the app that was still resolved this way.
