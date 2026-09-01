### Claims the code does not back — 2026-09-01

*Schema: none*

#### Fixed
- **The Unraid template no longer offers two settings that do nothing.**
  `BACKUP_CRON` and `BACKUP_RETENTION_DAYS` were presented as configuring a
  nightly database dump. Neither variable is read anywhere in the image, and
  `/config/backups` has never been written to. They rendered as real fields in
  Community Applications, so anyone who set them believed they had backups.
- **`docs/install.md` no longer describes `/config/backups` as "nightly
  database dumps"** or `/config/uploads` as holding avatars. Six other
  documents already carried the caveat; this table was the one that did not,
  and it re-introduced a claim the project had removed once before.
- **The privacy page no longer promises "no outbound request at all unless
  assisted reading is switched on."** That stopped being true when reminder
  delivery landed: the hourly scheduler makes SMTP connections and POSTs to
  webhook URLs with no user interaction.
- **`APP_URL` is no longer described as supplying links inside reminders.**
  Reminder bodies contain no links; the only thing that reads `APP_URL` is the
  decision to mark session cookies `secure`.

#### Added
- **A "Reminder delivery" section in the privacy documentation**, naming
  exactly what a reminder puts on the wire — the date's label, the contact's
  full name, the occurrence date and how far out it is — and why email is
  different in kind from a webhook you host yourself.
- **Known gaps now list the ones that were missing**: reminders cannot reach
  you at all because nothing can create a notification channel; there is no
  account management after the welcome wizard; tags and place editing exist in
  the schema with no UI.
