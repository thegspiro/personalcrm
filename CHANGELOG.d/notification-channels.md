### Reminders that actually arrive — 2026-09-01

*Schema: none*

#### Added
- **Settings → Reminders**, where you say where reminders should go: email
  through your own SMTP server, or ntfy, Gotify, Discord and plain webhooks by
  URL. Add as many as you like, switch each on or off, and send a test to prove
  one works before relying on it.
- **The important-date reminders the app has always promised now reach you.**
  The delivery engine — offsets per date, retry with backoff, a ledger so a
  restart never re-sends — was complete, and nothing could give it a
  destination, so the hourly job found no channel on every account and sent
  nothing. Every reminder policy set on a date was stored and silently never
  acted on.
- **The page says what a reminder puts on the wire**: the date's label, the
  person's name and when it falls — and that email travels through a relay
  whose logs keep it, where an ntfy or webhook URL can be a box on your own
  network.

#### Changed
- **SMTP passwords and webhook tokens are encrypted at rest**, AES-256-GCM
  under a key derived from `AUTH_SECRET` and separate from the one protecting
  the AI key. Rows written by hand before this page existed keep working and
  are re-encrypted the next time they are saved.
- **A credential that cannot be decrypted stops delivery** rather than being
  treated as absent. After a rotated `AUTH_SECRET` the alternative is an
  unauthenticated SMTP login, or a POST to a third-party host with its
  Authorization header quietly missing — a request that still leaves, just
  without its credential. The channel is flagged in Settings until you re-enter
  it.
- A reminder a day out now reads "tomorrow" rather than "in 1 days".
