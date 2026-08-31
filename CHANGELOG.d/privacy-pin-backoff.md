### Consistent privacy PIN backoff — 2026-08-31

*Schema: none*

#### Fixed
- **Wrong privacy PIN attempts now share one account-level backoff.** Unlocking,
  changing the PIN, and removing it all count toward the same limit, including
  across browsers or after cookies are cleared. Settings controls show the wait
  and remain unavailable until another attempt is allowed.
