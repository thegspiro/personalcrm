# Backing up and restoring

Everything worth keeping is under `/config`. The bundled container also creates
a consistent SQL backup automatically, but that dump complements rather than
replaces a copy of the entire volume.

| Path | Why it matters |
| --- | --- |
| `db/` | The database. Everything you've recorded. |
| `uploads/` | Contact avatars. The database stores only their generated paths, so the directory and database must be backed up and restored together. |
| `secrets.json` | The session signing key **and the database password**. Without it, a restored `db/` cannot be opened. |
| `backups/` | The automatic SQL dumps described below. They hold the database only — not `uploads/`, and not `secrets.json`. |
| `logs/`, `cache/` | Not worth keeping. |

## Automatic database dumps

The `svc-backup` s6 service starts only after MariaDB is ready and migrations
have completed. It runs daily at `BACKUP_TIME` (default `02:00`) in the
container's `TZ` and writes:

```text
/config/backups/personalcrm-YYYYMMDDTHHMMSSZ.sql.gz
```

`mariadb-dump --single-transaction --quick` gives a transactionally consistent
snapshot without stopping the app (the application tables use InnoDB). Output
is first written as a hidden/partial file on the same filesystem and renamed
only after both the dump and gzip succeed, so consumers see either the old
backup or a complete new one. An advisory file lock rejects overlapping manual and scheduled runs. Failures go to `docker logs personalcrm` with a `[backup]`
prefix; partial output and the mode-`0600` temporary client file are removed.

Before dumping, the service requires `BACKUP_MIN_FREE_MB` MiB free (default
`512`). This is a starting-space guard, not a quota guarantee: a database can
still grow or consume more than the remaining space. On any failure, existing
completed backups are retained. Monitor the container log and filesystem; the
service does not send notifications.

After a successful dump, completed dumps older than
`BACKUP_RETENTION_DAYS` (default `30`) are deleted. Age is based on file mtime
and means strictly older than the configured whole-day threshold. Retention
covers SQL dumps only, not uploads or `secrets.json`.

Run an extra backup at any time:

```bash
docker exec personalcrm /command/s6-setuidgid abc /etc/s6-overlay/scripts/backup-now
```

The service and manual command run as the `PUID`/`PGID`-backed `abc` account, so
published files have the configured host ownership. Database credentials are
read from `DATABASE_URL` (or generated secrets for bundled MariaDB), written to
a short-lived mode-`0600` MariaDB option file, and never placed in process
arguments or logs.

> **Backups are not encrypted.** SQL dumps can contain every private note and
> stored application secret. Files are mode `0600`, but anyone with host/root
> access can read them. Encrypt the host backup or destination and restrict
> `/config`; copying only `backups/` also omits uploads and `secrets.json`.

## Restore a SQL dump

Test restores in a disposable MariaDB 11 server first. For an in-place bundled
restore, prevent web traffic and stop only the app service while MariaDB remains
available:

1. Keep a safety copy of the current `/config`, including the selected dump.
2. Put the site behind maintenance mode, then stop the application service:

   ```bash
   docker exec personalcrm s6-svc -d /run/service/svc-app
   docker exec personalcrm s6-svc -d /run/service/svc-backup
   ```
3. Remove the existing database and import the dump through the local root
   socket (root socket authentication needs no password):

   ```bash
   docker exec personalcrm mariadb --socket=/run/mysqld/mysqld.sock \
     -e 'DROP DATABASE IF EXISTS personalcrm'
   gzip -dc personalcrm-20260902T020000Z.sql.gz | \
     docker exec -i personalcrm mariadb --socket=/run/mysqld/mysqld.sock
   ```

   For an external database, stop app traffic and use that server's
   administrator-approved clean-database procedure and client option file;
   never put its password on the command line.
4. Restore the matching `uploads/` and `secrets.json` from the volume backup.
5. Restart the container. Startup migrations safely advance an older restored
   schema.
6. Sign in and verify representative contacts, private records, interactions,
   and attachments before declaring the restore usable.

The dump includes `CREATE DATABASE`/`USE` statements for the configured database.
An external-database operator should restore into an isolated server or edit a
copy deliberately if the test database must use another name.

## Whole-volume backup

For the simplest complete backup, stop the container and copy all of `/config`:

```bash
docker stop personalcrm
tar czf personalcrm-config-$(date +%F).tar.gz -C /path/to/appdata personalcrm
docker start personalcrm
```

That captures the live database directory, the uploads, `secrets.json` and the
automatic dumps together. Stopping first is the point: never filesystem-copy
`/config/db` while MariaDB is running.

### A dump on demand, container running

The scheduled dump above is the supported way to do this, and it can be run at
any moment without waiting for `BACKUP_TIME`:

```bash
docker exec personalcrm /command/s6-setuidgid abc /etc/s6-overlay/scripts/backup-now
```

`--single-transaction` is what makes that consistent without locking — for the
database. The copy of `uploads/` is a separate step, and nothing holds avatars
still between the two: a photo replaced or removed in that gap is referenced
by one and absent from the other. What that costs on restore is exactly one
thing: that person shows their initials instead of a photo, and uploading one
again fixes it. Nothing else is affected. If you want the avatars exact as
well, take the stopped-container backup above.

On an external database the scheduler still runs and still writes to
`/config/backups`, reading its credentials from `DATABASE_URL`; `/config` then
holds `uploads/`, `secrets.json` and those dumps.

## Restoring

Onto a fresh container:
