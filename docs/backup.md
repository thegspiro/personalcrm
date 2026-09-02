# Backing up

Everything worth keeping is in the folder you mapped to `/config`. Back up that
one folder and you have backed up the whole installation.

| Path | Why it matters |
| --- | --- |
| `db/` | The database. Everything you've recorded. |
| `uploads/` | Contact avatars. The database stores only their generated paths, so the directory and database must be backed up and restored together. |
| `secrets.json` | The session signing key **and the database password**. Without it, a restored `db/` cannot be opened. |
| `backups/` | Reserved for database dumps. See the note below. |
| `logs/`, `cache/` | Not worth keeping. |

**`secrets.json` is the one people miss.** The bundled MariaDB's password is
generated on first boot and stored only there. Restore `db/` without it and the
data is intact and unreachable.

## A note on `backups/`

The folder is created at startup and the container reserves it for automatic
database dumps, but **nothing writes to it yet** — there is no scheduled dump in
the current version. Don't rely on finding anything in it. Until that exists,
use one of the methods below.

## Taking a backup

### The whole folder, container stopped

The simplest and the most reliable, because it cannot catch the database
mid-write:

```bash
docker stop personalcrm
tar czf personalcrm-$(date +%F).tar.gz -C /mnt/user/appdata personalcrm
docker start personalcrm
```

### A database dump, container running

If you'd rather not stop it, dump the database and copy `uploads/` and
`secrets.json` separately:

```bash
docker exec personalcrm bash -c \
  'mariadb-dump --single-transaction --user=personalcrm \
     --password="$(node -p "require(\"/config/secrets.json\").dbPassword")" \
     personalcrm' > personalcrm-$(date +%F).sql
```

`--single-transaction` is what makes this consistent without locking.

On an external database, take the dump with your own tooling — `/config` then
holds only `uploads/` and `secrets.json`.

## Restoring

Onto a fresh container:

1. Stop the container if it's running.
2. Put the `/config` folder back where it was, `secrets.json` included.
3. Start it. `init-migrate` brings the schema up to date if the backup came
   from an older version, so a restore and an upgrade can happen together.

Do not restore only the SQL when contacts have avatars: those rows would point
at missing files. Restore `uploads/` from the same backup generation as the
database. Conversely, extra unreferenced files are harmless and may be removed
after the matching database has been restored.

Restoring a `.sql` dump instead:

```bash
docker exec -i personalcrm bash -c \
  'mariadb --user=personalcrm \
     --password="$(node -p "require(\"/config/secrets.json\").dbPassword")" \
     personalcrm' < personalcrm-2026-08-25.sql
```

This needs the *same* `secrets.json` the dump was taken under, or the password
won't match.

## Checking a backup is real

A backup nobody has restored is a guess. Restore into a throwaway container
pointed at a copy of the folder, on a different port:

```bash
docker run --rm -e APP_URL=http://localhost:3001 \
  -v /tmp/restore-test:/config -p 3001:3000 \
  ghcr.io/thegspiro/personalcrm:latest
```

If you can sign in with your usual password and your people are there, the
backup is good.
