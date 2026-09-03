### Delivery outcomes, alias scoping and backup connections — 2026-09-03

*Schema: none*

#### Fixed
- **A delivery whose response is cut off short now fails instead of hanging.**
  An endpoint that sends headers and then closes the connection gracefully
  part-way through the body emits no completion and no error — only a socket
  close. The send stayed pending indefinitely, holding the scheduler pass open
  behind it and letting the row's lease expire into the duplicate delivery the
  deadline was added to prevent.
- **An alias belonging to another account is no longer read back.** The alias
  row's owner and its location's owner are separate columns, so an import or a
  restore can leave them disagreeing; the place list, the place page and the
  editor all fetched every related alias regardless, handing a stranger's
  wording to quick-add matching and to the form.
- **A place's alternate name can no longer take another place's real name.**
  The collision check asked only the alias table, which is derived from the
  places rather than authoritative over them, so a place whose canonical claim
  was missing had no protection — and since names resolve through aliases
  first, later entries naming that place would have been filed against the
  wrong one.
- **The scheduled backup connects the way the application does.** It rebuilt
  only user, password, host and port and then forced TCP, so a `DATABASE_URL`
  naming a socket or requiring TLS produced a dump that could not connect, or
  connected on weaker terms, while the application carried on working and
  nothing said the nightly backup had stopped. Sockets and CA verification are
  translated; any other connection option stops the run with a message naming
  it rather than quietly dropping it.
- **The place editor closes onto the saved row.** It closed as soon as the save
  returned, so reopening it before the refresh landed showed the alternate
  names as they were beforehand — and saving that form removed the one just
  added.
