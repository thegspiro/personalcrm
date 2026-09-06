### Back up through a mutual-TLS client identity — 2026-09-03

*Schema: none*

#### Added
- **A database that asks for a client certificate can be backed up.** A
  `DATABASE_URL` carrying `sslidentity` used to stop the backup outright, on the
  grounds that connecting without the identity would be connecting on weaker
  terms than the app — correct, but it left those installations with no backups
  at all. The bundle is now unpacked into the certificate and key the MariaDB
  client wants, so the dump connects on exactly the terms the application does.
  The unpacked files live only for the run, mode `0600`, in the same volatile
  directory as the password, and the passphrase never appears on a command
  line. A bundle that will not open stops the run and says which file, rather
  than falling back to a weaker connection.
- Connection options the backup genuinely cannot reproduce still stop it with
  their names in the message.
