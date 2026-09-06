### Reauthentication, destinations and the backup clock — 2026-09-03

*Schema: none*

#### Fixed
- **Confirming your current password is throttled, the way signing in is.**
  Changing the sign-in address or the password asks for the current one first
  — that check stands between a stolen session and a theft made permanent —
  and it took unlimited guesses, each costing a full password comparison.
- **The channel form no longer answers what a hostname resolves to.** Refusing
  a name that pointed somewhere non-public, while a name that resolved nowhere
  saved cleanly, let an ordinary account tell an internal host from one that
  does not exist. A name is now simply saved; an address typed in directly is
  still refused on the field, since that tells its author only what they just
  wrote, and the destination is checked in full before every delivery either
  way.
- **A tag belonging to another account is no longer shown on a contact.** The
  join and the tag are separate foreign keys, so an import or a restore can
  leave one account's contact carrying another's tag — which was rendered on
  the profile and handed to the edit form, where saving replaces every join.
- **A delivery that passes its deadline now ends the connection.** For email
  the send was abandoned but the session left running, so the message could
  still arrive after a failure had been recorded and a retry queued.
- **A failed email delivery no longer leaks connections.** With more than one
  address to try, a socket that failed *after* connecting re-entered the
  fallback and opened another that nothing was waiting for and nothing closed.
- **The scheduled backup survives the spring clock change.** On the day the
  clocks go forward the configured time may not exist — the default `02:00`
  does not, in `America/New_York` — and the scheduler exited on it, leaving
  the service restarting until the calendar moved past the day. The run moves
  to the first hour that does exist.
- **A rejected display name or email address says which field is wrong.** Both
  were validated by a schema whose complaint carried no field, so the form
  reported "check the highlighted fields" and highlighted none.
