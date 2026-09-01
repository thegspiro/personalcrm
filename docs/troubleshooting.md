# Troubleshooting

Start here:

```bash
docker logs --tail 50 personalcrm
curl -s http://127.0.0.1:3000/api/health
```

`/api/health` answers three questions at once:

```json
{"status":"ok","database":"up","setup":"pending","latencyMs":3,"uptimeSeconds":42}
```

| Field | Meaning |
| --- | --- |
| `status` | `ok`, or `error` with a message when the database can't be reached. |
| `database` | `up` / `down`. |
| `setup` | `pending` until the first account exists, then `complete`. |

A 503 here is also what makes Docker's healthcheck restart the container when
MariaDB never comes up.

## The container stops immediately

The preflight check refuses to start on a configuration that cannot work. The
log names which:

| Message | Fix |
| --- | --- |
| `APP_URL="…" is not an absolute http(s) URL` | Use a full URL: `https://crm.example.com`, not a bare hostname or path. |
| `DATABASE_URL is set but is not a mysql:// URL` | Use `mysql://user:password@host:3306/personalcrm`, or leave it empty for the bundled database. |
| `PORT="…" is not a number` | Set a port number, or unset it. |
| `/config is not writable` | Check the volume mapping, and that `PUID`/`PGID` own the folder on the host. |

Warnings — a bad `TZ`, an unset `APP_URL`, plain `http` on a real hostname —
are printed and startup continues.

## Signing in doesn't stick

You enter the right password and land back on the login page, with nothing in
the logs.

This is almost always `APP_URL`. Session cookies are marked `secure` only when
`APP_URL` starts with `https://`. If you reach the app over HTTPS through a
reverse proxy but `APP_URL` says `http://`, the browser is handed a cookie it
won't send back. Set `APP_URL` to the `https://` address you actually use and
restart. The preflight check warns about this case on boot.

## `/setup` sends me to the login page

An account already exists. `/setup` only opens on an instance with no accounts —
that's what stops a public instance being claimed by whoever finds it first.

If you've lost the password to the only account, there is currently no reset
flow. Recover by restoring a backup, or by deleting the `User` row directly in
the database, which frees `/setup` again — note that deleting the account
deletes everything it owns.

## The setup wizard keeps reappearing

The app sends you to `/welcome` until the wizard is finished or skipped. If it
returns every time you land on the dashboard, the write that marks it done is
failing — check `/api/health` for a database that has gone away.

## There's no Install button

Expected on some browsers. Only Chromium — Chrome and Edge — offers a real
install button. iOS Safari has no install API, so **Settings → App** shows the
Share → Add to Home Screen steps instead; it must be Safari, as Chrome and
Firefox on iOS cannot install. Desktop Firefox cannot install web apps at all,
and says so rather than showing a button that does nothing.

Installing also requires the page be served over HTTPS, or from `localhost`.
Over plain `http` on a LAN address no browser will offer it.

## An offline page is showing me old data

That's the point of the banner — it says how old the copy is. Only pages with
nothing private on them are ever stored, storage is off by default and opted
into per page, and everything is wiped when you lock the app or sign out.
Reconnect and the live page replaces it.

## Migrations fail on startup

The app deliberately refuses to run against a schema it doesn't match, so the
container stops. The log names the migration that failed. Restore your backup
and open an issue with that name — see [upgrade.md](upgrade.md).
