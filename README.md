# Personal CRM

A self-hosted personal relationship manager — for the people in your life, not for sales leads.

Track who you know, log the interactions you have, keep the things worth remembering, never miss an important date, and save conversation ideas for next time. Keep-in-touch cadences tell you who you're overdue to reach out to. An optional dating layer adds a pipeline, a date log with ratings, green and red flags, and compatibility notes.

Mobile-first for reading and quick logging, comfortable on a desktop for bulk entry. **MariaDB is built into the image**, so a deployment is one container and one appdata folder.

## Status

Under active development; nothing tagged as a release yet. See
[`CHANGELOG.md`](CHANGELOG.md) for what has landed and [`docs/`](docs/) for
everything else.

## Deploying

### Unraid (recommended)

Search **Personal CRM** in Community Applications, or add the template manually:

```
https://raw.githubusercontent.com/thegspiro/personalcrm/main/unraid/personalcrm.xml
```

| Setting | Default | Notes |
| --- | --- | --- |
| Port | `3000` | Web interface |
| Appdata | `/mnt/user/appdata/personalcrm` | Database, uploads, backups, secrets — **back this up** |
| `PUID` / `PGID` | `99` / `100` | Unraid's `nobody:users` |
| `TZ` | `America/New_York` | Drives reminders and "overdue" calculations |
| `APP_URL` | — | Your external URL, e.g. `https://crm.example.com`. Required for secure cookies behind HTTPS |
| `DISABLE_SIGNUP` | `false` | Set `true` once your accounts exist |
| `DATABASE_URL` | — | Leave empty to use the bundled MariaDB |

Open the WebUI and create your account — the first one is the administrator.

### Plain Docker

```bash
docker run -d --name personalcrm \
  -e PUID=99 -e PGID=100 -e TZ=America/New_York \
  -e APP_URL=http://localhost:3000 \
  -v /path/to/appdata:/config \
  -p 3000:3000 \
  ghcr.io/thegspiro/personalcrm:latest
```

### Bring your own database

Set `DATABASE_URL` and the bundled MariaDB never starts:

```
DATABASE_URL=mysql://user:password@dbhost:3306/personalcrm
```

[`docker-compose.yml`](docker-compose.yml) runs the app against a separate MariaDB container this way.

## What lives in `/config`

| Path | Contents |
| --- | --- |
| `db/` | MariaDB data directory |
| `uploads/` | Avatars and photos (no upload path writes here yet) |
| `backups/` | Created at boot; nothing writes here yet — [back up `/config` yourself](docs/deployment.md#backups) |
| `logs/` | MariaDB error log |
| `secrets.json` | Generated on first boot — session signing key and database password |

`secrets.json` is created once and reused, so sessions and the database survive an image upgrade. Back up the whole folder.

## Development

Requires Node 22 and a MariaDB you can reach.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your database
npx prisma migrate dev        # create the schema
SEED_DEMO=1 npm run db:seed   # optional: demo account and sample data
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npx playwright test` | End-to-end tests against a running instance |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Browse the database |

End-to-end tests expect an instance at `http://127.0.0.1:3200`; override with `E2E_BASE_URL`.

Setup, conventions and the rules that are not style preferences are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Architecture

- **Next.js 15** (App Router) with React 19 and server actions — one codebase for UI and API
- **Prisma** against **MariaDB**, migrations applied automatically at container start
- **Tailwind CSS v4** with Radix primitives
- **s6-overlay** supervises MariaDB and the app in one container and orders their startup

Every "type" in the app — interaction types, fact categories, relationship types, dating stages — is a database row you can rename, recolor, reorder, or add to, not a hardcoded list.

## Documentation

| Document | For |
| --- | --- |
| [Architecture](docs/architecture.md) | Layering, request context, container startup |
| [Data model](docs/data-model.md) | Every table, column, enum and migration |
| [Server actions](docs/server-actions.md) | The write surface, action by action |
| [Privacy](docs/privacy.md) | The PIN lock, offline caching, and where data can go |
| [Configuration](docs/configuration.md) | Environment variables and `/config` |
| [Deployment](docs/deployment.md) | Unraid, Docker, upgrades, backups, health |
| [Testing](docs/testing.md) | The three suites and what a change must pass |
| [Changelog](CHANGELOG.md) | What changed, when, and why |

## Licence

Apache 2.0. See [LICENSE](LICENSE).
