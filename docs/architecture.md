# Architecture

How the app is put together, and why it is put together that way.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15, App Router, React 19 |
| Writes | Server actions (no REST layer) |
| Data | Prisma 6 → MariaDB |
| Styling | Tailwind CSS v4, Radix primitives, `next-themes` |
| Packaging | One container: s6-overlay supervising MariaDB + the app |
| Tests | Vitest (unit + integration), Playwright (end-to-end) |

There is no separate API service and no client-side data store. Pages are
server components that query Prisma directly; mutations are server actions.
The one HTTP endpoint is `/api/health`, which exists for the container
healthcheck.

## Directory map

```
src/
  app/
    (app)/          signed-in routes — dashboard, people, timeline, dating,
                    family, gifts, ideas, tasks, settings, more, unlock
    (auth)/         login, signup, first-run setup
    (onboarding)/   the welcome flow, once per account
    api/health/     container healthcheck (the only route handler)
    manifest.ts     PWA manifest;  icon.tsx  draws the icon at build time
  components/       UI, grouped by feature; ui/ is the Radix-backed primitives
  lib/              pure logic — no Prisma, no request context, unit-testable
  server/
    actions/        server actions ("use server") — the write surface
    queries/        read queries for pages
    services/       multi-step writes shared by several actions
    privacy/        the lock: state, where-fragments, offline eligibility
    auth/           password hashing, sessions, first-run provisioning
    taxonomy/       seed definitions and per-account provisioning
    ai/             optional assisted parsing (deletable — see below)
    db/             Prisma client, app settings
    user/           per-request user + preferences context
    startup.ts      idempotent boot tasks
prisma/             schema, migrations, seeds
root/               s6-overlay service definitions baked into the image
tests/              unit | integration | e2e
```

## The layering rule

```
component ──▶ server action ──▶ service ──▶ Prisma
     │                │
     │                └──▶ lib/ (pure)
     └──▶ server query ──▶ Prisma
```

- **`src/lib/`** is pure. No Prisma import, no `server-only`, no request
  context. Cadence maths, date precision, quick-add parsing, reciprocity,
  debt balances, dietary grouping, custom-field coercion and family metadata
  all live here — which is why they can be unit-tested against a fixed clock
  with no database.
- **`src/server/services/`** holds writes that more than one action needs to
  get identically right (activity recomputation, custom-field persistence,
  ending a family pair). Services take a Prisma transaction client, so they
  compose inside a caller's transaction.
- **`src/server/actions/`** is the public write surface. Every action starts by
  resolving the owner and validating input; see
  [server-actions.md](server-actions.md).
- **`src/server/queries/`** holds the read queries pages use, each applying the
  privacy filter.

## Request context

Two `react.cache`-memoised helpers anchor a request:

- `getCurrentUser()` / `requireUser()` — [`server/auth/session.ts`](../src/server/auth/session.ts).
  Resolves the `pcrm_session` cookie to a `Session` row (matched on the token's
  SHA-256 hash), rejects expired or inactive accounts, and slides the expiry
  once a session is more than 75% through its 30-day life.
- `getUserContext()` — [`server/user/context.ts`](../src/server/user/context.ts).
  The user plus preferences plus **the account timezone**.

> Every date calculation in the app anchors to `UserContext.timezone`, never to
> `process.env.TZ`. The server's clock does not get to decide whether a birthday
> is today.

## Writes: the server-action contract

Every action in `src/server/actions/` follows the same shape:

1. `await owner()` — resolves `{ ownerId, timezone }`, redirecting if signed out.
2. Parse `FormData` through the typed helpers in
   [`actions/helpers.ts`](../src/server/actions/helpers.ts) (`str`, `num`,
   `bool`, `strList`, `instant`, `partialDate`, `plainDate`).
3. Validate with Zod.
4. Write inside `prisma.$transaction` when more than one table is touched.
5. Re-derive anything denormalised (activity, date sequences).
6. `revalidatePath`, then return `ActionResult` — `{ ok, error?, fieldErrors?, data? }`.

Two rules that are easy to lose:

- **Server actions are public POST endpoints.** They re-check the privacy lock
  themselves rather than trusting that the page was gated, and they re-validate
  every value — a `NUMBER` custom field cannot be talked into holding `"banana"`
  by a hand-rolled post.
- **Ownership is a `where` clause, not an assumption.** Every read and write is
  scoped by `ownerId` (or by a parent that is).

## Denormalised activity

`Contact.lastInteractionAt` and `Contact.nextTouchAt` are the only denormalised
fields, and [`services/contact-activity.ts`](../src/server/services/contact-activity.ts)
is the only writer. It always recomputes from the full interaction history:

- Logging something from three months ago must not read as "spoke today" — that
  would silently clear the person off the overdue list, the one thing this app
  exists to get right.
- Deleting the most recent interaction must fall back to the one before it.
- Future-dated interactions are excluded: a planned dinner is not something you
  have done.

Every write path that touches interactions — including the dating date log and
quick add — goes through it.

## Privacy enforcement lives in the query layer

The secondary PIN lock is enforced by where-fragments applied to queries
([`server/privacy/where.ts`](../src/server/privacy/where.ts)), not by components
that render nothing. With server components, a hidden section has still been
fetched and serialised into the payload. Full reasoning, including what the lock
does *not* protect against, is in [privacy.md](privacy.md).

## The optional AI layer is deletable

Quick add is [`lib/quick-parse.ts`](../src/lib/quick-parse.ts): chrono-node for
dates resolved in the account timezone, matching against your own contacts and
your own taxonomy slugs. No key, no network, always on.

People are matched before dates are read, because plenty of real names are also
months. A matched name is replaced with a private-use marker rather than cut
out, so neither the date reader nor the type reader can see it — and the marker
is what lets a possessive be put back afterwards. "at Sarah's place" names a
participant *and* is part of the sentence; removing it outright left titles like
"First time at 's place", which nothing downstream could repair.

`src/server/ai/` is a separate, optional layer that produces a better reading of
awkward phrasing when you switch it on and point it at a provider. The whole
directory can be deleted and quick add keeps working — that is the test of
whether the split is real. Its answer is run back through the local matcher
rather than trusted, so an assisted parse cannot do anything the local parse
refuses to do.

## Container startup

s6-overlay orders a chain of oneshots before the app is allowed to serve:

```
init-perms  →  init-preflight  →  init-mariadb  →  svc-mariadb  →  init-db-ready  →  init-migrate  →  svc-app
```

| Step | Does |
| --- | --- |
| `init-preflight` | Validates what the operator supplied — `APP_URL`, a writable `/config` — before anything else starts. Ordered first deliberately: a wrong value is far easier to read here than as a failure three services later |
| `init-perms` | Creates the `abc` user from `PUID`/`PGID`, makes `/config` writable, creates `db/ uploads/ backups/ logs/ cache/`. Only chowns recursively when the top-level owner is actually wrong |
| `init-mariadb` | Generates `/config/secrets.json` (0600) on first boot with a random DB password and `authSecret`, initialises the data directory, publishes `DATABASE_URL` and `AUTH_SECRET` into the supervision tree. Skipped entirely when `DATABASE_URL` is set |
| `svc-mariadb` | The bundled server (longrun) |
| `init-db-ready` | Waits for the socket |
| `init-migrate` | `prisma migrate deploy` |
| `svc-app` | `node server.js` (Next standalone) |

Because the secrets file is generated once and reused, sessions and the database
survive an image replacement — upgrading is `docker pull` and restart.

At the application's own boot, [`server/startup.ts`](../src/server/startup.ts)
runs two idempotent tasks: re-provisioning taxonomy defaults for every account
(so a release can add default terms without a manual seed) and purging expired
sessions. Both log and swallow failures — a container that refuses to start is
worse than one that missed a housekeeping pass.

## Client-side pieces

- **Offline reading** — a service worker (`public/sw.js`) caches pages you have
  visited, but only when the server has decided the account is safe to cache.
  Network-first, never cache-first, and every offline page shows how stale it
  is to the minute. Locking or signing out wipes the cache. Rules in
  [privacy.md](privacy.md#offline-caching).
- **Installable** — `src/app/manifest.ts` plus an icon drawn at build time in
  `src/app/icon.tsx`, so there is no binary asset to keep in sync with the theme.
- **Command palette** — ⌘K, searching people through the same privacy filter as
  every other read.

## Mobile-first constraints that are tested, not assumed

Two classes of bug were frequent enough to earn a permanent test
(`tests/e2e/layout.spec.ts`):

- **Horizontal overflow.** `truncate` only shrinks when *every* flex and grid
  ancestor carries `min-w-0`; both default to `min-width: auto`. A long name
  otherwise sets the page width and pushes buttons off-screen where they look
  tappable but are not. The spec asserts no route scrolls horizontally, ignoring
  containers that legitimately scroll.
- **Input font size.** Anything under 16px makes iOS zoom in on focus and never
  zoom back out. The floor sits outside `@layer` so no utility can defeat it.
