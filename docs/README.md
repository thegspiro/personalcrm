# Documentation

A self-hosted personal relationship manager. Next.js 15 + Prisma + MariaDB,
packaged as one container with the database built in.

## Running it

| Document | For |
| --- | --- |
| [install.md](install.md) | Unraid, Docker, Compose, and bring-your-own-database |
| [first-run.md](first-run.md) | The startup sequence, the admin account, and installing the app |
| [backup.md](backup.md) | What to keep and how to restore it |
| [upgrade.md](upgrade.md) | Pulling a newer image |
| [troubleshooting.md](troubleshooting.md) | When it doesn't come up |
| [configuration.md](configuration.md) | Every environment variable, and what lives in `/config` |

## Working on it

| Document | For |
| --- | --- |
| [architecture.md](architecture.md) | How the app is put together — layering, request context, container startup |
| [data-model.md](data-model.md) | Every table, column, enum and migration |
| [server-actions.md](server-actions.md) | The write surface, action by action |
| [privacy.md](privacy.md) | The PIN lock, offline caching, and where data can go |
| [testing.md](testing.md) | The three suites and what a change must pass |
| [../CHANGELOG.md](../CHANGELOG.md) | What changed, when, and why — released history |
| [../CHANGELOG.d/](../CHANGELOG.d/README.md) | Entries for changes not yet folded into it |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development setup and the rules that are not style preferences |
| [deployment.md](deployment.md) | Health endpoint, logs, and the operational detail behind the guides above |

## The shape of it in one page

- **One container.** MariaDB is bundled; s6-overlay orders preflight →
  permissions → database → migrations → app. Set `DATABASE_URL` and the bundled
  server never starts. Everything persistent is in `/config`.
- **No API layer.** Pages are server components querying Prisma directly;
  mutations are server actions. `GET /api/health` is the only route handler.
- **Every "type" is data.** Interaction types, fact categories, relationship
  types, dating stages, plan categories — all `TaxonomyTerm` rows you can
  rename, recolour, reorder or add to. Enums are reserved for states the code
  branches on.
- **Recording the past is a first-class case.** Backdating an interaction never
  reads as "spoke today"; half-remembered dates stay half-remembered.
- **Privacy is enforced in the query layer**, not in components, and it is an
  access gate rather than encryption.
- **Mobile-first**, with horizontal overflow and input font size covered by a
  permanent end-to-end test rather than by good intentions.

## Feature areas

| Area | Route | Notes |
| --- | --- | --- |
| Dashboard | `/` | Arrangeable widgets |
| People | `/people` | Contacts, phone numbers and addresses, facts, dates, significant moments, gifts, debts, dietary needs |
| Timeline | `/timeline` | Every interaction, unified |
| Family | `/family` | Households, relationship graph, generation banding, suggestions |
| Dating | `/dating` | Optional layer; pipeline, date log, flags, comparison |
| Ideas | `/ideas` | Conversation starters, and plans — things to do with someone |
| Tasks | `/tasks` | Follow-ups |
| Gifts | `/gifts` | Both directions |
| Places | `/locations` | Venues, who you have been there with, and what is planned |
| Settings | `/settings` | Look, Fields, Types, Home, Reminders, Quick add, Privacy, App |
| Welcome | `/welcome` | First-run onboarding, once per account |
| Unlock | `/unlock` | The privacy PIN |
| Offline | `/offline` | What the service worker serves for an uncached page |

## Known gaps

Documented so nobody assumes a feature works:

| Gap | State |
| --- | --- |
| **Cadence, task and digest reminders** | Important dates are delivered, hourly, through the channels you add under Settings → Reminders. The other three `ReminderEntity` values are never written: nothing nudges you about an overdue cadence, a due task, or a daily digest, and `digestHour`/`digestEnabled` are stored only |
| **Nightly backups** | `/config/backups` is created at boot and nothing writes to it — see [backup.md](backup.md) |
| **Avatar upload** | `Contact.avatarPath` is read and rendered throughout, but no upload path writes it and nothing writes to `/config/uploads` |
| **Account management** | Your name is set once in the welcome wizard and never again. There is no change-password, no email edit, no password reset and no session list |
| **Tags** | `Tag` and `ContactTag` exist in the schema with no UI behind them |
| **Finding a number by a different format** | Contact search matches the stored string, so someone filed as `+1 (555) 010-4477` is not found by typing `5550104477`. Deliberate: normalising would mean guessing a country nobody supplied |
| **Editing a place** | Places are created implicitly from what you type as a venue. Only the name, address and link are ever set — the phone, notes and coordinates in the schema have no editor |
| **Offline writes** | Deliberately absent. Non-GET requests go straight to the network and fail honestly rather than pretending something was saved |

The project is under active development and nothing has been tagged as a
release yet.
