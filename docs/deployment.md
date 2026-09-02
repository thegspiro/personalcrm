# Deployment and operations

The published image bundles MariaDB, so a normal deployment is **one container
and one folder**.

> The step-by-step guides live alongside this file and are the place to start:
> [installing](install.md), [first run](first-run.md), [backing up](backup.md),
> [upgrading](upgrade.md) and [troubleshooting](troubleshooting.md). This page
> is the reference behind them — what the startup chain does, what the health
> endpoint reports, and where the logs are.

## Unraid (the intended path)

Search **Personal CRM** in Community Applications, or add the template
manually:

```
https://raw.githubusercontent.com/thegspiro/personalcrm/main/unraid/personalcrm.xml
```

| Setting | Default | Notes |
| --- | --- | --- |
| Port | `3000` | Web interface |
| Appdata | `/mnt/user/appdata/personalcrm` | Mapped to `/config` — **back this up** |
| `PUID` / `PGID` | `99` / `100` | Unraid's `nobody:users` |
| `TZ` | `America/New_York` | Container clock |
| `APP_URL` | — | Required behind HTTPS, or sign-in fails |
| `DISABLE_SIGNUP` | `false` | Set `true` once your accounts exist |
| `DATABASE_URL` | — | Leave empty to use the bundled MariaDB |

Open the WebUI and create your account, then follow the welcome flow — see [first run](first-run.md).

## Plain Docker

```bash
docker run -d --name personalcrm \
  -e PUID=99 -e PGID=100 -e TZ=America/New_York \
  -e APP_URL=http://localhost:3000 \
  -v /path/to/appdata:/config \
  -p 3000:3000 \
  ghcr.io/thegspiro/personalcrm:latest
```

## Bring your own database

Set `DATABASE_URL` and the bundled MariaDB never starts — `init-mariadb` and
`init-db-ready` exit immediately and `svc-mariadb` parks itself rather than
churning through restarts:

```
DATABASE_URL=mysql://user:password@dbhost:3306/personalcrm
```

The database must be MariaDB or MySQL with `utf8mb4`. Migrations still run at
container start, so the credentials need DDL rights.

[`docker-compose.yml`](../docker-compose.yml) runs the app against a separate
MariaDB container this way. Compose requires `AUTH_SECRET` in your `.env`
(`openssl rand -base64 48`) and refuses to start without it — the container
would otherwise generate one into `/config/secrets.json`, and being explicit
keeps the secret with the stack that owns the database.

## Behind a reverse proxy

- Set `APP_URL` to the **external** HTTPS URL. Session cookies are `httpOnly`,
  `sameSite=lax`, and marked `secure` only when `APP_URL` starts with
  `https://`. Get this wrong and sign-in appears to succeed and then bounces.
- Forward `Host` and the usual `X-Forwarded-*` headers.
- Server actions accept bodies up to **8 MB** — raise `client_max_body_size`
  / equivalent to match.
- The application sends clickjacking, MIME-sniffing, referrer and browser
  permissions headers itself. Dating, unlock and settings also send
  `private, no-store`, so nothing the closed lock hides is left in a cache.
- **Send `Strict-Transport-Security` from the proxy, not the app.** Next
  resolves header rules during `next build` and bakes them into the image, so
  the application cannot know whether your deployment is served over HTTPS —
  and an HSTS header sent by a plain-http install is remembered by the browser
  and locks you out of your own instance.
- The app serves on `3000` inside the container.

## What happens on first boot

```
init-perms → init-preflight → init-mariadb → svc-mariadb → init-db-ready → init-migrate
                                                                        ├→ svc-app
                                                                        └→ svc-backup
```

1. `/config/{db,uploads,backups,logs,cache}` are created and chowned to
   `PUID:PGID`.
2. Preflight validates what the operator supplied — `APP_URL`, a writable
   `/config`. A bad value **stops the boot here** with the reason in the log,
   rather than surfacing as a failure three services later; see
   [troubleshooting](troubleshooting.md).
3. `/config/secrets.json` is generated (mode `0600`) with a random database
   password and `authSecret`.
4. MariaDB initialises its data directory under `/config/db`.
5. `prisma migrate deploy` applies every pending migration.
6. The app and backup scheduler start. The scheduler waits until `BACKUP_TIME`
   (02:00 by default, in `TZ`) before its first run; it never delays app startup.
7. On its own boot the app re-provisions taxonomy defaults for every account,
   purges expired sessions, and starts the hourly reminder scheduler.
8. You open the WebUI, create the first account, and the welcome flow at `/welcome` takes it from there.

The recursive `chown` of `/config` only runs when the top-level owner is
actually wrong — it is slow once `db/` is large.

## Upgrading

```bash
docker pull ghcr.io/thegspiro/personalcrm:latest
# then recreate the container
```

That is the whole procedure. Because `secrets.json` persists, sessions and the
database survive image replacement, and `init-migrate` applies any new
migrations before the app is allowed to serve. New default taxonomy terms
introduced by a release are backfilled onto existing accounts at boot, without
overwriting anything you have renamed.

**Before upgrading:** stop the container and copy `/config`. There is no
automatic pre-upgrade dump.

## Health

`GET /api/health` — used by the container `HEALTHCHECK` (30s interval, 90s
start period, 3 retries).

```json
{ "status": "ok", "database": "up", "setup": "complete", "latencyMs": 3, "version": "dev", "uptimeSeconds": 412 }
```

`setup` is `pending` until the first account exists, so a booted-but-unconfigured
instance is distinguishable from a working one without opening a browser.

It runs `SELECT 1` against the database, so a `503` with `"database": "down"`
means the app is serving but MariaDB is not up — which is what makes Docker
restart the container rather than leave it half-alive.

## Backups

`svc-backup` makes a gzip-compressed, transactionally consistent SQL dump each
day at `BACKUP_TIME` (default `02:00` in `TZ`). It publishes through a temporary
file, prevents concurrent runs, requires 512 MiB free by default, and deletes
files older than `BACKUP_RETENTION_DAYS` (default 30) only after a successful
run. It starts after `init-migrate`, alongside the app, and writes as
`PUID:PGID`. Failures appear in container logs as `[backup] ERROR`; an incomplete
backup is removed and older completed backups remain.

These dumps are **not encrypted** and do not include `uploads/` or
`secrets.json`. Restrict and encrypt the host destination, and continue backing
up all of `/config`. For external databases the same service uses
`DATABASE_URL`; credentials are passed in a temporary mode-`0600` option file,
not arguments or logs. See [backup.md](backup.md) for manual backup, exact
retention semantics, and a restore procedure.

## Logs

- App: `docker logs personalcrm` — s6 prefixes each service.
- MariaDB errors: `/config/logs/`.
- Startup housekeeping logs as `[startup] …`, permissions as `[init-perms] …`,
  secrets as `[secrets] …`.

## Architecture support

The image builds for `linux/amd64` and `linux/arm64`. Node comes from the
official nodejs.org build with its checksum verified; s6-overlay from the
upstream release.
