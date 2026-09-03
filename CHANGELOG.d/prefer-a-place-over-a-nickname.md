### A place's own name beats another place's nickname — 2026-09-03

*Schema: none*

#### Fixed
- **A location is now found by its own name even when another location has the
  same name as a nickname.** Nicknames were consulted first, so an account
  whose place had lost its own index entry — through an import, a restore, a
  repair, or an upgrade caught mid-deployment — had every mention of that
  place's real name filed against the other one, and any address or website
  typed alongside it written onto that other place. The conflicting entry is
  also repaired rather than left to misdirect the next mention.
- **A tag name that is blank or too long now says so.** Both came back as
  "Please check the highlighted fields" with nothing highlighted and no word
  about what was wrong — and a name of only spaces gets past the browser's own
  check, so this was reachable from the form.
- **Backups of an external database whose name contains a double quote now
  work.** The name was read back out of the generated options file, quotes and
  all, so the dump asked for a database that does not exist and failed every
  night while the application carried on connecting normally.
