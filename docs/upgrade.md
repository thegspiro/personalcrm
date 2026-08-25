# Upgrading

Pull a newer image and restart. Migrations are applied automatically at startup,
so there is no separate step.

```bash
docker pull ghcr.io/thegspiro/personalcrm:latest
docker stop personalcrm && docker rm personalcrm
# then re-run your original `docker run`, or on Unraid just hit Apply
```

Take a backup first — see [backup.md](backup.md). Migrations that change the
schema cannot be undone by downgrading the image.

## What survives, and why

`secrets.json` is generated once and then left alone. It holds the session
signing key and the bundled database's password, which is what lets a replaced
container open the same database and honour the sessions issued by the old one —
you are not signed out by an upgrade.

Your `/config` folder is the installation. The image is disposable.

## What happens on the first boot of a new version

`init-migrate` runs `prisma migrate deploy` before the app is allowed to start.
If a migration fails, the app **does not start** — the container stops with the
error rather than serving requests against a schema it doesn't match. That is
deliberate: a half-migrated database serving traffic is worse than a container
that is plainly down.

If that happens, the log line names the migration. Restore your backup and open
an issue with that name.

## Existing accounts and the first-run wizard

The release that added the setup wizard also added an `onboardingCompletedAt`
column, and its migration backfills every existing account. Upgrading does not
drag anyone back through setup — the wizard is only ever shown to accounts
created after the upgrade.

## Downgrading

Only safe back to a version with the same schema. If you must go further back,
restore the `/config` folder from a backup taken on that version. Pointing an
older image at a newer database is not supported and will fail at startup rather
than corrupt anything.
