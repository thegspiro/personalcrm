# Documentation

A self-hosted personal relationship manager. Next.js 15 + Prisma + MariaDB,
packaged as one container with the database built in.

## Start here

| Document | For |
| --- | --- |
| [architecture.md](architecture.md) | How the app is put together — layering, request context, container startup |
| [data-model.md](data-model.md) | Every table, column, enum and migration |
| [server-actions.md](server-actions.md) | The write surface, action by action |
| [privacy.md](privacy.md) | The PIN lock, offline caching, and where data can go |
| [configuration.md](configuration.md) | Environment variables and `/config` |
| [deployment.md](deployment.md) | Unraid, Docker, upgrades, backups, health |
| [testing.md](testing.md) | The three suites and what a change must pass |
| [../CHANGELOG.md](../CHANGELOG.md) | What changed, when, and why |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development setup and the rules that are not style preferences |

## The shape of it in one page

- **One container.** MariaDB is bundled; s6-overlay orders permissions →
  database → migrations → app. Set `DATABASE_URL` and the bundled server never
  starts. Everything persistent is in `/config`.
- **No API layer.** Pages are server components querying Prisma directly;
  mutations are server actions. `GET /api/health` is the only route handler.
- **Every "type" is data.** Interaction types, fact categories, relationship
  types, dating stages — all `TaxonomyTerm` rows you can rename, recolour,
  reorder or add to. Enums are reserved for states the code branches on.
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
| People | `/people` | Contacts, facts, dates, life events, gifts, debts, dietary needs |
| Timeline | `/timeline` | Every interaction, unified |
| Family | `/family` | Households, relationship graph, generation banding, suggestions |
| Dating | `/dating` | Optional layer; pipeline, date log, flags, comparison |
| Ideas | `/ideas` | Conversation starters |
| Tasks | `/tasks` | Follow-ups |
| Gifts | `/gifts` | Both directions |
| Settings | `/settings` | Look, Fields, Types, Home, Privacy |
| Unlock | `/unlock` | The privacy PIN |

## Known gaps

Documented so nobody assumes a feature works:

| Gap | State |
| --- | --- |
| **Notifications and reminders** | `NotificationChannel` and `ReminderLog` exist and are migrated; `UserPreference.digestHour`/`digestEnabled` and `ImportantDate.reminderDaysBefore` are stored. Nothing sends anything — there is no scheduler, and `node-cron`/`nodemailer` are dependencies that no code imports |
| **Nightly backups** | `/config/backups` is created at boot and nothing writes to it. Back up `/config` yourself — see [deployment.md](deployment.md#backups) |
| **Avatar upload** | `Contact.avatarPath` is read and rendered throughout, but no upload path writes it and nothing writes to `/config/uploads` |
| **Offline writes** | Deliberately absent. Non-GET requests go straight to the network and fail honestly rather than pretending something was saved |

The project is under active development and nothing has been tagged as a
release yet.
