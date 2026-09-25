### Failed reminder deliveries say why in the container log — 2026-09-25

*Schema: none*

#### Added
- **Every failed reminder delivery now writes a warning to the container log**
  with the reason — a refused connection, a rejected token, an address that
  answered 404 — alongside the channel, the kind of reminder, the attempt
  number and when it will be tried again. Before, the log said at most
  `failed=1`, and the reason could only be read on the channel's card in
  Settings. The line says `gaveUp=true` when a reminder has used every attempt
  and `paused=true` when that failure paused the channel. It never names the
  person a reminder was about.
- **Troubleshooting has a section on reminders that aren't arriving**,
  including why `localhost` in a channel's address points at the container
  rather than the machine running it.
