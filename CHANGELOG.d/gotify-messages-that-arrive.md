### Gotify reminders that arrive, and say more when they do — 2026-09-09

*Schema: none*

#### Fixed
- **A Gotify channel saved with the address off your browser's bar now works.**
  Gotify's messages endpoint is `/message`, and its root answers a POST with
  404 — so the obvious thing to paste saved cleanly, tested red, and failed
  every reminder with an HTTP code and nothing to act on. A bare address is
  filled in; any path you actually typed, including the subpath a reverse proxy
  puts Gotify behind, is left alone.
- **Gotify reminders no longer arrive silently.** With no priority set Gotify
  defaults to 0, which its clients file away without a sound: the reminder was
  delivered, correctly, into a list nobody was looking at — the one failure a
  working transport cannot report. Channels now send priority 5 unless you say
  otherwise, and the Gotify card has a **Priority** field (0–10) for making one
  quiet or urgent. Existing channels pick up 5 without being re-saved.

#### Added
- **Gotify messages carry the reminder as fields as well as prose**, under
  `extras`, for anything reading the message rather than looking at it: the
  policy, the day, how many days away it is, the label or title, the person's
  name, and for a digest each entry the message listed. It says exactly what
  the body already says and nothing more — in particular no record
  identifiers, which would be a stable handle for the same person across every
  notification that the wording itself is not.
- **The digest renders as the list it is.** Gotify is told the body is
  markdown, so its headings and bullets no longer arrive as one unbroken block.
- **Tapping a Gotify reminder opens the app**, when `APP_URL` is set. Unset,
  no link is sent rather than one guessed from a request the hourly scheduler
  does not have.

#### Changed
- The sample digest sent by the test button now carries the same structured
  fields a real one does, still built entirely from invented people, so the
  payload the scheduler sends is the payload the button proves. It is marked as
  a sample in the fields as well as in the subject and the body, so anything
  wired to read them does not act on five invented people the first time you
  test a channel.
