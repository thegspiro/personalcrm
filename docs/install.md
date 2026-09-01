# Installing

Personal CRM ships as one container with MariaDB built in. There is one thing to
map — a folder for your data — and one thing to decide: the URL you'll reach it
on.

## Unraid

Search **Personal CRM** in Community Applications, or add the template manually:

```
https://raw.githubusercontent.com/thegspiro/personalcrm/main/unraid/personalcrm.xml
```

| Setting | Default | What it does |
| --- | --- | --- |
| Port | `3000` | The web interface. |
| Appdata | `/mnt/user/appdata/personalcrm` | Database, uploads, backups and secrets. **This is the thing to back up.** |
| `PUID` / `PGID` | `99` / `100` | Unraid's `nobody:users`. The container adopts this identity so appdata stays readable from the host. |
| `TZ` | `America/New_York` | The fallback timezone. Each account sets its own, which wins. |
| `APP_URL` | — | The address you actually open the app on. See below — this one is worth getting right. |
| `DISABLE_SIGNUP` | `false` | Set `true` once your accounts exist, so nobody who reaches the page can make one. |
| `DATABASE_URL` | — | Leave empty to use the bundled MariaDB. |

## Plain Docker

```bash
docker run -d --name personalcrm \
  -e PUID=99 -e PGID=100 -e TZ=America/New_York \
  -e APP_URL=http://localhost:3000 \
  -v /path/to/appdata:/config \
  -p 3000:3000 \
  ghcr.io/thegspiro/personalcrm:latest
```

## Docker Compose

[`docker-compose.yml`](../docker-compose.yml) runs the app against a separate
MariaDB container, which is the bring-your-own-database arrangement below.

## Getting `APP_URL` right

`APP_URL` is the external address of the app — `https://crm.example.com`, not
the container's internal one.

It matters more than it looks. Session cookies are marked `secure` only when
`APP_URL` starts with `https://`. Behind a reverse proxy terminating TLS, an
`APP_URL` of `http://…` produces a login form that accepts your password and
then returns you to the login form, with nothing in the logs to explain it. If
sign-in doesn't stick, check this first.

The container's preflight check warns about a plain-`http` `APP_URL` on a
non-local host, and refuses to start if the value isn't a URL at all.

## Bring your own database

Set `DATABASE_URL` and the bundled MariaDB never starts:

```
DATABASE_URL=mysql://user:password@dbhost:3306/personalcrm
```

The database must exist and the user must be able to create tables in it —
migrations run at every container start.

## What lives in `/config`

| Path | Contents |
| --- | --- |
| `db/` | MariaDB data directory |
| `uploads/` | Reserved for avatars and photos — nothing writes here yet |
| `backups/` | Reserved for database dumps — nothing writes here yet, see [backup.md](backup.md) |
| `logs/` | MariaDB error log |
| `cache/` | Next.js cache — safe to delete |
| `secrets.json` | Generated on first boot: session signing key and database password |

`secrets.json` is created once and reused, which is what lets sessions and the
database survive an image upgrade. Back up the whole folder — see
[backup.md](backup.md).

## Next

[First run](first-run.md) — what happens when you open it.
