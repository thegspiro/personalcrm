# Testing

Three suites, three different jobs.

| Suite | Runner | Needs | Count | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest | Nothing | 14 files | `npm test` |
| Integration | Vitest | A throwaway MariaDB | 8 files | `npm test` (skipped without `TEST_DATABASE_URL`) |
| End-to-end | Playwright | A running instance | 13 specs | `npx playwright test` |

File counts are what is in the tree; the case counts move with every change, so
run the suite rather than trusting a number written here.

## Unit tests — `tests/unit/`

Everything in `src/lib/` is pure: no Prisma, no request context, no clock it
does not own. That is what makes these fast and worth writing.

| File | Covers |
| --- | --- |
| `cadence.test.ts` | Overdue / due-soon maths, snoozing, DST |
| `dates.test.ts`, `date-precision.test.ts` | Timezone-anchored calendar maths, partial dates |
| `quick-parse.test.ts` | Reading a typed line into an interaction |
| `reciprocity.test.ts` | Who has been reaching out, and when to say nothing |
| `debts.test.ts`, `dietary.test.ts` | Balances per currency; must-avoid grouping |
| `family-suggestions.test.ts` | Graph inference, and what it refuses to infer |
| `custom-fields.test.ts` | Type coercion and validation |
| `offline.test.ts` | Offline-cacheability rules |
| `preflight.test.ts` | The container's start-up validation |
| `setup-checklist.test.ts` | What the welcome flow considers done |
| `taxonomy-seeds.test.ts` | The seeded default terms |
| `ai-providers.test.ts` | Forgiving response parsing across provider dialects |

The date-sensitive suites run against a **fixed clock**, and the timezone-aware
ones assert in a zone that is not UTC — a DST bug in `snoozeUntil` that
millisecond arithmetic hid is the reason.

## Integration tests — `tests/integration/`

Run against a real MariaDB, because the things they check are things Prisma and
the schema do, not things a mock can:

- `contact-activity.test.ts` — that backdating never reads as "spoke today",
  and that deleting the newest interaction falls back correctly.
- `privacy.test.ts` — that locked rows never come back from a query, counts
  included.
- `family.test.ts` — reciprocal pairs, ending a link, dismissals.
- `dating.test.ts` — the Interaction/DateEntry pair and sequence renumbering.
- `custom-fields.test.ts` — server-side validation and the delete sweep.
- `quick-add.test.ts`, `phase4d.test.ts`, `plans.test.ts` — the newer write paths.

### Setting one up

```bash
# any MariaDB you can reach; the database name MUST end in _test
TEST_DATABASE_URL="mysql://user:pass@127.0.0.1:3306/personalcrm_test"
```

Put it in `.env` — `tests/setup-env.ts` loads that file so nobody has to export
it by hand. Without the variable the integration suites skip; they never fall
back to `DATABASE_URL`.

Two guards worth knowing about:

- **The URL must name a database ending in `_test`.** `tests/integration/db.ts`
  throws otherwise, because `reset()` truncates every table.
- **`fileParallelism` is off.** The suites share one database, so they must not
  run concurrently.

`TABLES` in `tests/integration/db.ts` is the truncation list. **Every new table
has to be added to it** — a missing entry leaks rows between tests and produces
failures that look like anything except the real cause.

## End-to-end tests — `tests/e2e/`

Playwright against an **already-running** instance, so the same suite points at
`next start` locally or at the built container.

```bash
E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test
```

Three projects, run in order:

| Project | Viewport | Notes |
| --- | --- | --- |
| `first-run` | Desktop | Creates the account every other project signs in with |
| `mobile` | iPhone 13 | **Mobile first** — the primary flows are verified at phone width |
| `desktop` | 1440×900 | |

`fullyParallel: false`, one worker: the suite shares one instance and one
account, so it must not race itself.

`layout.spec.ts` is not a feature spec — it asserts that **no route scrolls
horizontally**, ignoring content that legitimately scrolls inside its own
container. Horizontal overflow on a phone pushes buttons off-screen where they
look tappable and are not, and it has recurred often enough to earn a permanent
test.

`date-field.spec.ts` is the other one, and it drives the picker with
`pressSequentially` rather than `fill`. `fill` sets a whole value in one event,
which is not what a keyboard does: it never produces the half-typed year the
field used to reject, and it never leaves a day stranded in a month too short
for it. Both bugs were invisible to a `fill`-based test and obvious to anyone
holding a phone. Anything that validates as you type wants the same treatment.

### Specs that must clean up after themselves

`privacy.spec.ts` creates a private contact. Leaving one behind correctly
switches offline caching off **for the whole account**, which then fails the
next project for a reason that has nothing to do with it. It cleans up, and
`offline.spec.ts` heals a leftover lock rather than inheriting one.

## Running everything

```bash
npm run typecheck                     # tsc --noEmit
npm test                              # unit + integration
npm run build                         # production build
npx playwright test                   # against a running instance
```

These are what a change is expected to pass locally before it is pushed; CI
runs the same set on every pull request.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull
request, on pushes to `main`, and on demand. Four jobs, all independent:

| Job | Does | Why it exists |
| --- | --- | --- |
| **Typecheck, lint, build** | `tsc --noEmit`, `eslint .`, `next build` | The cheapest signal, so it does not queue behind a database |
| **Unit and integration tests** | Vitest against a MariaDB service container | The suites that need a real database |
| **End-to-end tests** | Playwright against the **standalone bundle**, on an empty database | What actually ships, not `next dev` |
| **Container build and boot** | Builds the image, boots it on an empty volume, restarts it | The container is the product |

Three details worth knowing before editing the workflow:

**The integration suites must not pass vacuously.** They skip themselves when
`TEST_DATABASE_URL` is missing — deliberately, so a developer without a spare
database is not blocked. In CI that same behaviour would turn a broken service
container into a green tick with 83 tests silently not run. The test job writes
the JSON reporter output and
[`assert-integration-ran.mjs`](../.github/scripts/assert-integration-ran.mjs)
fails the build if any of them skipped.

**Lint is only enforced here.** `next.config.ts` sets
`eslint.ignoreDuringBuilds`, so a build never fails on lint. The lint job is the
only thing between a lint error and `main`.

**The E2E job runs the standalone bundle.** `npm run build` produces
`.next/standalone`, and the workflow copies `public/` and `.next/static` into it
exactly as the Dockerfile does, then runs `node .next/standalone/server.js`.
Testing `next dev` would skip the tracing step that has its own failure modes.

The container job boots the image on an empty volume and then restarts it —
which is the pair of things every phase has verified by hand: a first boot that
generates secrets, initialises MariaDB under `/config/db` and applies every
migration, and a restart that reuses both rather than starting over.

### Lint findings that are warnings, not errors

`eslint-config-next` 16 ships the React Compiler rule set, and three of its
rules flag patterns this codebase uses on purpose. They are set to `warn` in
[`eslint.config.mjs`](../eslint.config.mjs), with the reasoning next to them, so
that lint is a gate that can actually be enforced rather than one permanently
red:

- `react-hooks/set-state-in-effect` — the `mounted` pattern behind theme-aware
  controls. The theme is only known after hydration.
- `react-hooks/purity` — `Date.now()` in a client component rendering a
  relative day count.
- `react-hooks/immutability` — writing `document.documentElement.dataset` so an
  accent change shows before the action returns.

Everything else, `react-hooks/rules-of-hooks` included, fails the build.

## What a change is expected to bring with it

| Change | Test it needs |
| --- | --- |
| Anything in `src/lib/` | A unit test — that is why the module is pure |
| A new table | An entry in the integration `TABLES` list |
| An `isPrivate` column | A line in `countPrivateRows`, plus privacy coverage |
| A new write path | Integration coverage that the denormalised activity fields survive backdating and deletion |
| A new page or widget | It must appear in `layout.spec.ts`'s route sweep |
