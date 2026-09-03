# Configuration

Everything the app reads from its environment, and everything it keeps on disk.

## Environment variables

### Deployment

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `APP_URL` | — | Behind HTTPS | Your external URL, e.g. `https://crm.example.com`. Session cookies are marked `secure` only when this starts with `https://`, so sign-in fails silently behind a TLS proxy if it is unset |
| `DATABASE_URL` | generated | No | Set it and the bundled MariaDB never starts. Format: `mysql://user:password@host:3306/personalcrm` |
| `AUTH_SECRET` | generated | No (container) / Yes (bare) | 32+ random bytes. Signs sessions **and** derives the keys that encrypt a stored AI key and every notification channel credential. Generated into `/config/secrets.json` on first boot. Rotating it signs everyone out, makes a stored AI key undecryptable — treated as no key — and **stops reminder delivery** on any channel with a saved password or token until it is re-entered |
| `DISABLE_SIGNUP` | `false` | No | Set `true` once your accounts exist. The first-run wizard still works on an empty instance |
| `TZ` | `Etc/UTC` (image) | No | Container clock. Note the account's own `UserPreference.timezone` is what every reminder and "overdue" calculation actually uses — this only affects logs and the default for a brand-new account |
| `PUID` / `PGID` | `99` / `100` | No | Unraid's `nobody:users`. `/config` is chowned to this |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | No | Set in the image |
| `APP_VERSION` | `dev` | No | Reported by `/api/health` |
| `UPLOADS_DIR` | `/config/uploads` | No | Server-only avatar storage. For a bare install, set this to a persistent directory writable by the app. A path inside `public/` or the `.next/` build output is refused, symlinks followed — everything there is served as a static asset to anyone who knows the name — so an upload fails and is logged rather than published |
| `BACKUP_TIME` | `02:00` | No | Daily automatic dump time in 24-hour `HH:MM`, interpreted in `TZ` |
| `BACKUP_RETENTION_DAYS` | `30` | No | Completed SQL dumps strictly older than this many days are deleted after a successful backup |
| `BACKUP_MIN_FREE_MB` | `512` | No | Refuse to start a dump when `/config/backups` has less than this many MiB free; `0` disables the starting-space guard |
| `BACKUP_RUNTIME_DIR` | `/run/personalcrm` | No | Where the short-lived MariaDB option file holding the database password is written. Deliberately volatile and never the `/config` volume the dumps are published on, so a killed run cannot leave the credential beside them. Change it only if `/run` is unwritable |

### Optional assisted reading

Only consulted when the feature is switched on in Settings. First match wins:

| Variable | Notes |
| --- | --- |
| `AI_API_KEY` | The neutral name — prefer this |
| `OPENAI_API_KEY` | Accepted because it is what people already have set |
| `ANTHROPIC_API_KEY` | Same |
| `GEMINI_API_KEY` | Same |

An env-supplied key wins over one pasted in Settings, cannot be edited from the
app, and keeps the key out of the database and therefore out of your backups.
Provider, base URL and model are configured in Settings (stored in
`AppSetting`), not in the environment.

### Development and test only

| Variable | Notes |
| --- | --- |
| `TEST_DATABASE_URL` | Integration tests truncate this database between runs — it must **never** point at real data |
| `E2E_BASE_URL` | Playwright target, default `http://127.0.0.1:3200` |
| `PLAYWRIGHT_CHROMIUM_PATH` | Use an already-installed Chromium instead of downloading one |
| `SEED_DEMO` | `1` to create the demo account and sample data |
| `SEED_DEMO_EMAIL` / `SEED_DEMO_PASSWORD` | Override the demo credentials |

[`.env.example`](../.env.example) is the starting point for local development.

## `/config` — the only volume

| Path | Contents | Back up? |
| --- | --- | --- |
| `db/` | MariaDB data directory | **Yes** |
| `uploads/` | Contact avatars, stored under random server-generated names and served only through the authenticated, privacy-filtered avatar endpoint | **Yes** |
| `secrets.json` | `authSecret` + `dbPassword`, mode `0600` | **Yes — without it the database is unreadable** |
| `backups/` | Daily atomic, gzip-compressed MariaDB dumps; mode `0600`, retained for 30 days by default | **Yes, but dumps are not encrypted and omit uploads/secrets** |
| `logs/` | MariaDB error log | No |
| `cache/` | Scratch | No |

Back up the whole folder. Automatic dump files are plaintext and may contain private records; encrypt the
backup destination. `secrets.json` is generated once and reused, which is
why sessions and the database survive an image upgrade — losing it while keeping
`db/` leaves you with a database nobody can log into.

## Per-account settings (not environment)

Account name, email, password, and active sessions are managed under **Settings
→ Account**. Email and password changes require the current password. Changing
the password keeps the requesting session, revokes all other sessions, and
closes the requesting session's privacy unlock. Password recovery remains
disabled until the installation has a trusted delivery or administrator-assisted
mechanism; no environment variable enables an unsafe token-in-logs fallback.

These live in the database and are edited in **Settings**, not in the container
config:

| Where | What |
| --- | --- |
| `UserPreference` | Theme, accent, density, **timezone**, week start, default cadence, digest hour, privacy lock switch, hide-dating, blur-private-notes |
| `DashboardLayout` | Which home-screen widgets are on, in what order, with what row counts |
| `TaxonomyTerm` | Every type list in the app — labels, colours, icons, order |
| `CustomFieldDefinition` | User-defined fields on contacts, dating profiles, interactions and dates |
| `AppSetting` | Instance-wide: first-run state, AI provider/base URL/model/key, address-lookup provider/base URL |

The account timezone is the one to get right: every cadence, every "overdue",
every date parse in quick add is anchored to it rather than to the server clock.
